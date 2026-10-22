import { generatePublicId } from "../../infrastructure/public-id";
import {
  campaignSchema,
  creativeSchema,
  slotSchema,
  placementSchema,
  versionSchema,
  type Campaign,
  type Creative,
  type AdSlot,
  type Placement,
  type AdQuery,
  type CampaignInput,
  type CreativeInput,
  type SlotInput,
  type PlacementInput,
} from "./schema";

const meta = "revision, created_at AS createdAt, updated_at AS updatedAt";
const campaignColumns = `id, name, notes, enabled, starts_at AS startsAt, ends_at AS endsAt, ${meta}`;
const creativeColumns = `id, name, type, draft, published_version AS publishedVersion, ${meta}`;
const slotColumns = `app_id AS appId, slot_key AS slotKey, name, format, enabled, max_items AS maxItems, ${meta}`;
const placementColumns = `id, campaign_id AS campaignId, app_id AS appId, slot_key AS slotKey, creative_id AS creativeId, target_url AS targetUrl, priority, enabled, starts_at AS startsAt, ends_at AS endsAt, ${meta}`;
const versionColumns =
  "creative_id AS creativeId, version, content, published_at AS publishedAt";
type Row = Record<string, unknown>;
const decodeCampaign = (r: Row) =>
  campaignSchema.parse({ ...r, enabled: !!r.enabled });
const decodeSlot = (r: Row) => slotSchema.parse({ ...r, enabled: !!r.enabled });
const decodePlacement = (r: Row) =>
  placementSchema.parse({ ...r, enabled: !!r.enabled });
const decodeVersion = (r: Row) =>
  versionSchema.parse({ ...r, content: JSON.parse(String(r.content)) });
// A single joined read gives the draft and current published snapshot from the same database snapshot.
const creativeSelect = `SELECT c.*, v.content AS publishedContent, v.published_at AS publishedAt FROM
 (SELECT ${creativeColumns} FROM ad_creatives) c LEFT JOIN ad_creative_versions v ON v.creative_id=c.id AND v.version=c.publishedVersion`;
const decodeCreative = (r: Row) =>
  creativeSchema.parse({
    id: r.id,
    name: r.name,
    type: r.type,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    publishedVersion: r.publishedVersion,
    draft: JSON.parse(String(r.draft)),
    published:
      r.publishedVersion === null
        ? null
        : {
            creativeId: r.id,
            version: r.publishedVersion,
            content: JSON.parse(String(r.publishedContent)),
            publishedAt: r.publishedAt,
          },
  });

/** SQL belongs to this capability; all App-scoped methods require an explicit App identity. */
export class AdsRepository {
  constructor(private readonly db: D1Database) {}
  private statement(sql: string, args: unknown[] = []) {
    return this.db.prepare(sql).bind(...args);
  }
  private async page<T>(
    select: string,
    where: string,
    args: unknown[],
    order: string,
    query: AdQuery,
    decode: (row: Row) => T,
  ) {
    const [count, rows] = await this.db.batch<Row>([
      this.statement(
        `SELECT COUNT(*) AS total FROM (${select}) WHERE ${where}`,
        args,
      ),
      this.statement(
        `SELECT * FROM (${select}) WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...args, query.pageSize, (query.page - 1) * query.pageSize],
      ),
    ]);
    return {
      items: rows!.results.map(decode),
      total: Number(count!.results[0]!.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async campaign(id: string) {
    const row = await this.statement(
      `SELECT ${campaignColumns} FROM ad_campaigns WHERE id=?`,
      [id],
    ).first<Row>();
    return row ? decodeCampaign(row) : null;
  }
  campaigns(q: AdQuery) {
    return this.page(
      `SELECT ${campaignColumns} FROM ad_campaigns`,
      q.enabled === undefined ? "1" : "enabled=?",
      q.enabled === undefined ? [] : [Number(q.enabled)],
      "createdAt DESC, id DESC",
      q,
      decodeCampaign,
    );
  }
  async createCampaign(input: CampaignInput, now: string) {
    const row = await this.statement(
      `INSERT INTO ad_campaigns(id,name,notes,enabled,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) RETURNING ${campaignColumns}`,
      [
        generatePublicId("ADCA", new Date(now), "Asia/Shanghai"),
        input.name,
        input.notes,
        Number(input.enabled),
        input.startsAt,
        input.endsAt,
        now,
        now,
      ],
    ).first<Row>();
    return decodeCampaign(row!);
  }
  async updateCampaign(v: Campaign, now: string) {
    const row = await this.statement(
      `UPDATE ad_campaigns SET name=?,notes=?,enabled=?,starts_at=?,ends_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING ${campaignColumns}`,
      [
        v.name,
        v.notes,
        Number(v.enabled),
        v.startsAt,
        v.endsAt,
        now,
        v.id,
        v.revision,
      ],
    ).first<Row>();
    return row ? decodeCampaign(row) : null;
  }
  async deleteCampaign(id: string, revision: number) {
    return (
      (
        await this.statement(
          "DELETE FROM ad_campaigns WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM ad_placements WHERE campaign_id=?)",
          [id, revision, id],
        ).run()
      ).meta.changes > 0
    );
  }

  async creative(id: string) {
    const row = await this.statement(`${creativeSelect} WHERE c.id=?`, [
      id,
    ]).first<Row>();
    return row ? decodeCreative(row) : null;
  }
  creatives(q: AdQuery) {
    return this.page(
      creativeSelect,
      "1",
      [],
      "createdAt DESC,id DESC",
      q,
      decodeCreative,
    );
  }
  async createCreative(input: CreativeInput, now: string) {
    const id = generatePublicId("ADCR", new Date(now), "Asia/Shanghai");
    await this.statement(
      "INSERT INTO ad_creatives(id,name,type,draft,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      [id, input.name, input.type, JSON.stringify(input.draft), now, now],
    ).run();
    return (await this.creative(id))!;
  }
  async updateCreative(v: Creative, now: string) {
    const result = await this.statement(
      "UPDATE ad_creatives SET name=?,draft=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      [v.name, JSON.stringify(v.draft), now, v.id, v.revision],
    ).run();
    return result.meta.changes ? this.creative(v.id) : null;
  }
  async publishCreative(id: string, revision: number, now: string) {
    // The conditional INSERT and pointer update share one D1 transaction. A stale revision inserts nothing.
    const results = await this.db.batch<Row>([
      this.statement(
        `INSERT INTO ad_creative_versions(creative_id,version,content,published_at)
        SELECT id,COALESCE(published_version,0)+1,draft,? FROM ad_creatives WHERE id=? AND revision=?
        AND NOT EXISTS(SELECT 1 FROM ad_creative_versions v WHERE v.creative_id=ad_creatives.id AND v.version=ad_creatives.published_version AND v.content=ad_creatives.draft)`,
        [now, id, revision],
      ),
      this.statement(
        `UPDATE ad_creatives SET published_version=COALESCE(published_version,0)+1,revision=revision+1,updated_at=?
        WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM ad_creative_versions v WHERE v.creative_id=ad_creatives.id AND v.version=COALESCE(ad_creatives.published_version,0)+1)`,
        [now, id, revision],
      ),
      this.statement(`${creativeSelect} WHERE c.id=?`, [id]),
    ]);
    const row = results[2]!.results[0];
    const current = row ? decodeCreative(row) : null;
    // A same-content publish is a no-op only when the expected revision still matches.
    return results[1]!.meta.changes || current?.revision === revision
      ? current
      : null;
  }
  versions(id: string, q: AdQuery) {
    return this.page(
      `SELECT ${versionColumns} FROM ad_creative_versions`,
      "creativeId=?",
      [id],
      "version DESC",
      q,
      decodeVersion,
    );
  }
  async version(id: string, version: number) {
    const r = await this.statement(
      `SELECT ${versionColumns} FROM ad_creative_versions WHERE creative_id=? AND version=?`,
      [id, version],
    ).first<Row>();
    return r ? decodeVersion(r) : null;
  }
  async deleteCreative(id: string, revision: number) {
    return (
      (
        await this.statement(
          "DELETE FROM ad_creatives WHERE id=? AND revision=? AND published_version IS NULL AND NOT EXISTS(SELECT 1 FROM ad_placements WHERE creative_id=?)",
          [id, revision, id],
        ).run()
      ).meta.changes > 0
    );
  }

  async slot(appId: string, key: string) {
    const r = await this.statement(
      `SELECT ${slotColumns} FROM ad_slots WHERE app_id=? AND slot_key=?`,
      [appId, key],
    ).first<Row>();
    return r ? decodeSlot(r) : null;
  }
  slots(appId: string, q: AdQuery) {
    return this.page(
      `SELECT ${slotColumns} FROM ad_slots`,
      `appId=?${q.enabled === undefined ? "" : " AND enabled=?"}`,
      q.enabled === undefined ? [appId] : [appId, Number(q.enabled)],
      "createdAt DESC,slotKey",
      q,
      decodeSlot,
    );
  }
  async createSlot(
    appId: string,
    v: SlotInput & { maxItems: number },
    now: string,
  ) {
    const r = await this.statement(
      `INSERT INTO ad_slots(app_id,slot_key,name,format,enabled,max_items,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(app_id,slot_key) DO NOTHING RETURNING ${slotColumns}`,
      [
        appId,
        v.slotKey,
        v.name,
        v.format,
        Number(v.enabled),
        v.maxItems,
        now,
        now,
      ],
    ).first<Row>();
    return r ? decodeSlot(r) : null;
  }
  async updateSlot(v: AdSlot, now: string) {
    const r = await this.statement(
      `UPDATE ad_slots SET name=?,enabled=?,max_items=?,revision=revision+1,updated_at=? WHERE app_id=? AND slot_key=? AND revision=? RETURNING ${slotColumns}`,
      [
        v.name,
        Number(v.enabled),
        v.maxItems,
        now,
        v.appId,
        v.slotKey,
        v.revision,
      ],
    ).first<Row>();
    return r ? decodeSlot(r) : null;
  }
  async deleteSlot(appId: string, key: string, revision: number) {
    return (
      (
        await this.statement(
          "DELETE FROM ad_slots WHERE app_id=? AND slot_key=? AND revision=? AND NOT EXISTS(SELECT 1 FROM ad_placements WHERE app_id=? AND slot_key=?)",
          [appId, key, revision, appId, key],
        ).run()
      ).meta.changes > 0
    );
  }

  async placement(appId: string, id: string) {
    const r = await this.statement(
      `SELECT ${placementColumns} FROM ad_placements WHERE app_id=? AND id=?`,
      [appId, id],
    ).first<Row>();
    return r ? decodePlacement(r) : null;
  }
  placements(q: AdQuery, appId?: string) {
    const conditions: string[] = [],
      args: unknown[] = [];
    for (const [field, value] of Object.entries({
      appId,
      campaignId: q.campaignId,
      creativeId: q.creativeId,
      slotKey: q.slotKey,
      enabled: q.enabled === undefined ? undefined : Number(q.enabled),
    })) {
      if (value !== undefined) {
        conditions.push(`${field}=?`);
        args.push(value);
      }
    }
    return this.page(
      `SELECT ${placementColumns} FROM ad_placements`,
      conditions.join(" AND ") || "1",
      args,
      "priority DESC,createdAt,id",
      q,
      decodePlacement,
    );
  }
  // References and eligibility are checked again within the write statement, avoiding read/write races.
  private eligibility = `EXISTS(SELECT 1 FROM ad_campaigns WHERE id=?) AND EXISTS(
    SELECT 1 FROM ad_slots s JOIN ad_creatives c ON c.id=? WHERE s.app_id=? AND s.slot_key=?
    AND c.type=CASE WHEN s.format='card' THEN 'card' ELSE 'image' END AND (?=0 OR c.published_version IS NOT NULL))`;
  async createPlacement(appId: string, v: PlacementInput, now: string) {
    const r = await this.statement(
      `INSERT INTO ad_placements(id,campaign_id,app_id,slot_key,creative_id,target_url,priority,enabled,starts_at,ends_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${this.eligibility} RETURNING ${placementColumns}`,
      [
        generatePublicId("ADPL", new Date(now), "Asia/Shanghai"),
        v.campaignId,
        appId,
        v.slotKey,
        v.creativeId,
        v.targetUrl,
        v.priority,
        Number(v.enabled),
        v.startsAt,
        v.endsAt,
        now,
        now,
        v.campaignId,
        v.creativeId,
        appId,
        v.slotKey,
        Number(v.enabled),
      ],
    ).first<Row>();
    return r ? decodePlacement(r) : null;
  }
  async updatePlacement(v: Placement, now: string) {
    const r = await this.statement(
      `UPDATE ad_placements SET campaign_id=?,slot_key=?,creative_id=?,target_url=?,priority=?,enabled=?,starts_at=?,ends_at=?,revision=revision+1,updated_at=? WHERE app_id=? AND id=? AND revision=? AND ${this.eligibility} RETURNING ${placementColumns}`,
      [
        v.campaignId,
        v.slotKey,
        v.creativeId,
        v.targetUrl,
        v.priority,
        Number(v.enabled),
        v.startsAt,
        v.endsAt,
        now,
        v.appId,
        v.id,
        v.revision,
        v.campaignId,
        v.creativeId,
        v.appId,
        v.slotKey,
        Number(v.enabled),
      ],
    ).first<Row>();
    return r ? decodePlacement(r) : null;
  }
  async deletePlacement(appId: string, id: string, revision: number) {
    return (
      (
        await this.statement(
          "DELETE FROM ad_placements WHERE app_id=? AND id=? AND revision=?",
          [appId, id, revision],
        ).run()
      ).meta.changes > 0
    );
  }
  async delivery(appId: string, key: string, now: string) {
    const [slots, items] = await this.db.batch<Row>([
      this.statement(
        `SELECT ${slotColumns} FROM ad_slots WHERE app_id=? AND slot_key=?`,
        [appId, key],
      ),
      this.statement(
        `SELECT p.campaign_id AS campaignId,p.id AS placementId,p.creative_id AS creativeId,v.version AS publishedVersion,v.content,p.target_url AS targetUrl
        FROM ad_placements p JOIN ad_campaigns a ON a.id=p.campaign_id JOIN ad_slots s ON s.app_id=p.app_id AND s.slot_key=p.slot_key
        JOIN ad_creatives c ON c.id=p.creative_id JOIN ad_creative_versions v ON v.creative_id=c.id AND v.version=c.published_version
        WHERE p.app_id=? AND p.slot_key=? AND p.enabled=1 AND a.enabled=1 AND s.enabled=1
        AND c.type=CASE WHEN s.format='card' THEN 'card' ELSE 'image' END
        AND (a.starts_at IS NULL OR a.starts_at<=?) AND (a.ends_at IS NULL OR a.ends_at>?)
        AND (p.starts_at IS NULL OR p.starts_at<=?) AND (p.ends_at IS NULL OR p.ends_at>?)
        ORDER BY p.priority DESC,p.created_at,p.id LIMIT COALESCE((SELECT max_items FROM ad_slots WHERE app_id=? AND slot_key=?),1)`,
        [appId, key, now, now, now, now, appId, key],
      ),
    ]);
    const slot = slots!.results[0];
    return slot
      ? {
          appId,
          slotKey: key,
          format: slot.format,
          items: items!.results.map((r) => ({
            ...r,
            content: JSON.parse(String(r.content)),
          })),
        }
      : null;
  }
}
