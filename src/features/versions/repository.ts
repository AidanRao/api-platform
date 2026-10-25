import { packageInfoSchema, type AppVersion, type CreateVersion, type PageQuery, type Settings, type VersionFields } from "./schema";

const columns = `v.version, v.version_code AS versionCode, v.release_type AS releaseType, v.release_notes AS releaseNotes, v.package_info AS packageInfo, v.revision, v.created_at AS createdAt, v.updated_at AS updatedAt,
  v.segment_ids AS segmentIds`;
type Row = Omit<AppVersion, "segmentIds" | "packageInfo"> & { segmentIds: string; packageInfo: string | null };
const decode = (row: Row): AppVersion => ({ ...row, segmentIds: (JSON.parse(row.segmentIds) as string[]).sort(), packageInfo: row.packageInfo === null ? null : packageInfoSchema.parse(JSON.parse(row.packageInfo)) });

export class VersionRepository {
  // Read configuration from the primary before resolving shared segment membership.
  private readonly db: D1DatabaseSession;
  constructor(db: D1Database, readonly appId: string) { this.db = db.withSession("first-primary"); }
  async settings(): Promise<Settings> {
    return await this.db.prepare(`SELECT latest_version AS latestVersion, revision FROM app_version_settings WHERE app_id=?`).bind(this.appId).first<Settings>()
      ?? { latestVersion: null, revision: 1 };
  }
  private init() { return this.db.prepare("INSERT OR IGNORE INTO app_version_settings(app_id) VALUES(?)").bind(this.appId); }
  async get(version: string): Promise<AppVersion | null> {
    const row = await this.db.prepare(`SELECT ${columns} FROM app_versions v WHERE v.app_id=? AND v.version=?`).bind(this.appId, version).first<Row>();
    return row ? decode(row) : null;
  }
  async list(q: PageQuery) {
    const [count, items] = await this.db.batch<Record<string, unknown>>([
      this.db.prepare("SELECT COUNT(*) AS total FROM app_versions WHERE app_id=?").bind(this.appId),
      this.db.prepare(`SELECT ${columns} FROM app_versions v WHERE v.app_id=? ORDER BY version_code DESC,version DESC LIMIT ? OFFSET ?`).bind(this.appId, q.pageSize, (q.page - 1) * q.pageSize),
    ]);
    return { items: (items!.results as Row[]).map(decode), total: Number(count!.results[0]!.total), ...q };
  }
  async create(input: CreateVersion, timestamp: string) {
    const references = JSON.stringify(input.segmentIds);
    const result = await this.db.prepare(`INSERT OR IGNORE INTO app_versions(app_id,version,version_code,release_type,segment_ids,release_notes,package_info,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
        SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS (SELECT 1 FROM segments WHERE id=ref.value)
      )`)
      .bind(this.appId, input.version, input.versionCode, input.releaseType, references, input.releaseNotes, input.packageInfo === null ? null : JSON.stringify(input.packageInfo), timestamp, timestamp, references).run();
    return result.meta.changes ? this.get(input.version) : null;
  }
  async update(version: string, revision: number, fields: VersionFields, timestamp: string) {
    const references = JSON.stringify(fields.releaseType === "full" ? [] : fields.segmentIds);
    const result = await this.db.prepare(`UPDATE app_versions SET version_code=?,release_type=?,segment_ids=?,
      release_notes=?,package_info=?,revision=revision+1,updated_at=?
      WHERE app_id=? AND version=? AND revision=?
      AND (?='full' OR NOT EXISTS (
        SELECT 1 FROM app_version_settings WHERE app_id=app_versions.app_id AND latest_version=app_versions.version
      )) AND NOT EXISTS (
        SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS (SELECT 1 FROM segments WHERE id=ref.value)
      )`)
      .bind(fields.versionCode, fields.releaseType, references, fields.releaseNotes, fields.packageInfo === null ? null : JSON.stringify(fields.packageInfo), timestamp, this.appId, version, revision, fields.releaseType, references).run();
    return result.meta.changes ? this.get(version) : null;
  }
  async setLatest(version: string | null, revision: number): Promise<boolean> {
    const result = await this.db.batch([this.init(), this.db.prepare(`UPDATE app_version_settings SET latest_version=?,revision=revision+1
      WHERE app_id=? AND revision=? AND (? IS NULL OR EXISTS (
        SELECT 1 FROM app_versions WHERE app_id=app_version_settings.app_id AND version=? AND release_type='full'
      ))`)
      .bind(version, this.appId, revision, version, version)]);
    return result[1]!.meta.changes === 1;
  }
  async setSegments(version: string, revision: number, ids: string[], timestamp: string): Promise<boolean> {
    const references = JSON.stringify([...new Set(ids)].sort());
    const result = await this.db.prepare(`UPDATE app_versions SET segment_ids=?,revision=revision+1,updated_at=?
      WHERE app_id=? AND version=? AND revision=? AND release_type='gray'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS (SELECT 1 FROM segments WHERE id=ref.value)
      )`)
      .bind(references, timestamp, this.appId, version, revision, references).run();
    return result.meta.changes === 1;
  }
  async targets(): Promise<{ version: string; versionCode: number; segmentIds: string[] }[]> {
    const rows = await this.db.prepare(`SELECT version,version_code AS versionCode,segment_ids AS segmentIds FROM app_versions
      WHERE app_id=? AND release_type='gray' AND json_array_length(segment_ids)>0`).bind(this.appId).all<{version: string; versionCode: number; segmentIds: string}>();
    return rows.results.map((r) => ({ version: r.version, versionCode: r.versionCode, segmentIds: JSON.parse(r.segmentIds) as string[] }));
  }
  async delete(version: string, revision: number): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM app_versions WHERE app_id=? AND version=? AND revision=?
      AND NOT EXISTS(SELECT 1 FROM app_version_settings WHERE app_id=? AND latest_version=?)
      AND json_array_length(segment_ids)=0`)
      .bind(this.appId, version, revision, this.appId, version).run();
    return result.meta.changes === 1;
  }
}
