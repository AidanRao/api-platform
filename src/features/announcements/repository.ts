import type { Announcement, CreateAnnouncement, ListQuery } from "./schema";

type Row = Omit<Announcement, "isPinned"> & { isPinned: number };
const columns = `id, title, content, is_pinned AS isPinned, status,
  published_at AS publishedAt, revision, created_at AS createdAt, updated_at AS updatedAt`;
const decode = (row: Row): Announcement => ({ ...row, isPinned: row.isPinned === 1 });

export class AnnouncementRepository {
  constructor(private readonly db: D1Database, private readonly appId: string) {}

  async list(query: ListQuery) {
    const where = query.status ? "app_id = ? AND status = ?" : "app_id = ?";
    const params = query.status ? [this.appId, query.status] : [this.appId];
    // One batch keeps the count and page in the same database snapshot.
    const [count, page] = await this.db.batch<Record<string, unknown>>([
      this.db.prepare(`SELECT COUNT(*) AS total FROM announcements WHERE ${where}`).bind(...params),
      this.db.prepare(`SELECT ${columns} FROM announcements WHERE ${where}
        ORDER BY is_pinned DESC, published_at DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(...params, query.pageSize, (query.page - 1) * query.pageSize),
    ]);
    return { items: (page!.results as Row[]).map(decode), page: query.page, pageSize: query.pageSize, total: Number(count!.results[0]!.total) };
  }

  async get(id: string): Promise<Announcement | null> {
    const row = await this.db.prepare(`SELECT ${columns} FROM announcements WHERE app_id = ? AND id = ?`)
      .bind(this.appId, id).first<Row>();
    return row === null ? null : decode(row);
  }

  async create(input: CreateAnnouncement, timestamp: string): Promise<Announcement> {
    const row = await this.db.prepare(`INSERT INTO announcements
      (app_id, id, title, content, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
      .bind(this.appId, crypto.randomUUID(), input.title, input.content, Number(input.isPinned), timestamp, timestamp).first<Row>();
    if (!row) throw new Error("Announcement insert returned no row");
    return decode(row);
  }

  async update(value: Announcement, timestamp: string): Promise<Announcement | null> {
    const row = await this.db.prepare(`UPDATE announcements SET title = ?, content = ?, is_pinned = ?, status = ?,
      published_at = ?, revision = revision + 1, updated_at = ? WHERE app_id = ? AND id = ? AND revision = ? RETURNING ${columns}`)
      .bind(value.title, value.content, Number(value.isPinned), value.status, value.publishedAt, timestamp, this.appId, value.id, value.revision).first<Row>();
    return row ? decode(row) : null;
  }

  async delete(id: string, revision: number): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM announcements WHERE app_id = ? AND id = ? AND revision = ?")
      .bind(this.appId, id, revision).run();
    return result.meta.changes === 1;
  }
}
