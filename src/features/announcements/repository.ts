import type { Announcement, CreateAnnouncement, ListQuery } from "./schema";
import { generatePublicId } from "../../infrastructure/public-id";

type Row = Omit<Announcement, "isPinned" | "tags"> & { isPinned: number; tags: string };
const columns = `id, title, content, tags, cover_url AS coverUrl, is_pinned AS isPinned, status,
  published_at AS publishedAt, revision, created_at AS createdAt, updated_at AS updatedAt`;
const decode = (row: Row): Announcement => ({ ...row, isPinned: row.isPinned === 1, tags: JSON.parse(row.tags) as string[] });

export class AnnouncementRepository {
  constructor(private readonly db: D1Database, private readonly appId: string, private readonly idGenerator = generatePublicId) {}

  async list(query: ListQuery) {
    let where = query.status ? "app_id = ? AND status = ?" : "app_id = ?";
    const params = query.status ? [this.appId, query.status] : [this.appId];
    if (query.tag !== undefined) {
      where += " AND EXISTS (SELECT 1 FROM json_each(announcements.tags) WHERE json_each.value = ?)";
      params.push(query.tag);
    }
    // One batch keeps the count and page in the same database snapshot.
    const [count, page] = await this.db.batch<Record<string, unknown>>([
      this.db.prepare(`SELECT COUNT(*) AS total FROM announcements WHERE ${where}`).bind(...params),
      this.db.prepare(`SELECT ${columns} FROM announcements WHERE ${where}
        ORDER BY is_pinned DESC, published_at DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(...params, query.pageSize, (query.page - 1) * query.pageSize),
    ]);
    return { items: (page!.results as Row[]).map(decode), page: query.page, pageSize: query.pageSize, total: Number(count!.results[0]!.total) };
  }

  async tags(status?: Announcement["status"]) {
    const where = status ? "a.app_id = ? AND a.status = ?" : "a.app_id = ?";
    const params = status ? [this.appId, status] : [this.appId];
    const result = await this.db.prepare(`SELECT t.value AS tag, COUNT(DISTINCT a.id) AS count
      FROM announcements AS a, json_each(a.tags) AS t
      WHERE ${where} AND t.type = 'text'
      GROUP BY t.value ORDER BY count DESC, tag COLLATE BINARY ASC`).bind(...params).all<{ tag: string; count: number }>();
    return { items: result.results };
  }

  async get(id: string): Promise<Announcement | null> {
    const row = await this.db.prepare(`SELECT ${columns} FROM announcements WHERE app_id = ? AND id = ?`)
      .bind(this.appId, id).first<Row>();
    return row === null ? null : decode(row);
  }

  async create(input: CreateAnnouncement, timestamp: string): Promise<Announcement> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = this.idGenerator("ANCE", new Date(timestamp), "Asia/Shanghai");
      const row = await this.db.prepare(`INSERT OR IGNORE INTO announcements
        (app_id, id, title, content, cover_url, tags, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
        .bind(this.appId, id, input.title, input.content, input.coverUrl, JSON.stringify(input.tags), Number(input.isPinned), timestamp, timestamp).first<Row>();
      if (row) return decode(row);
    }
    throw new Error("Unable to generate a unique announcement ID");
  }

  async update(value: Announcement, timestamp: string): Promise<Announcement | null> {
    const row = await this.db.prepare(`UPDATE announcements SET title = ?, content = ?, cover_url = ?, tags = ?, is_pinned = ?, status = ?,
      published_at = ?, revision = revision + 1, updated_at = ? WHERE app_id = ? AND id = ? AND revision = ? RETURNING ${columns}`)
      .bind(value.title, value.content, value.coverUrl, JSON.stringify(value.tags), Number(value.isPinned), value.status, value.publishedAt, timestamp, this.appId, value.id, value.revision).first<Row>();
    return row ? decode(row) : null;
  }

  async delete(id: string, revision: number): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM announcements WHERE app_id = ? AND id = ? AND revision = ?")
      .bind(this.appId, id, revision).run();
    return result.meta.changes === 1;
  }
}
