import type { Members, SegmentQuery, StoredSegment } from "./schema";

type Row = Omit<StoredSegment, "counts"> & { studentNameCount: number; studentIdCount: number; ssoIdCount: number };
const columns = `id,name,snapshot_key AS snapshotKey,revision,created_at AS createdAt,updated_at AS updatedAt,
 student_name_count AS studentNameCount,student_id_count AS studentIdCount,sso_id_count AS ssoIdCount`;
function decode({ studentNameCount, studentIdCount, ssoIdCount, ...row }: Row): StoredSegment {
  return { ...row, counts: { student_name: studentNameCount, student_id: studentIdCount, sso_id: ssoIdCount } };
}
export class SegmentRepository {
  private readonly db: D1DatabaseSession;
  constructor(db: D1Database) { this.db = db.withSession("first-primary"); }
  async get(id: string) { const row = await this.db.prepare(`SELECT ${columns} FROM segments WHERE id=?`).bind(id).first<Row>(); return row ? decode(row) : null; }
  async getMany(ids: readonly string[]) {
    if (!ids.length) return [];
    const rows = await this.db.prepare(`SELECT ${columns} FROM segments WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(JSON.stringify(ids)).all<Row>();
    return rows.results.map(decode);
  }
  async list(q: SegmentQuery) {
    const where = q.search ? "WHERE instr(name,?)>0 OR instr(id,?)>0" : "";
    const args = q.search ? [q.search, q.search] : [];
    const [count, page] = await this.db.batch<Record<string, unknown>>([
      this.db.prepare(`SELECT COUNT(*) AS total FROM segments ${where}`).bind(...args),
      this.db.prepare(`SELECT ${columns} FROM segments ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...args, q.pageSize, (q.page - 1) * q.pageSize),
    ]);
    return { items: (page!.results as Row[]).map(decode).map(({ snapshotKey: _key, ...s }) => s), total: Number(count!.results[0]!.total), page: q.page, pageSize: q.pageSize };
  }
  async create(id: string, name: string, key: string, members: Members, timestamp: string) {
    const result = await this.db.prepare(`INSERT OR IGNORE INTO segments(id,name,snapshot_key,student_name_count,student_id_count,sso_id_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id, name, key, members.student_name.length, members.student_id.length, members.sso_id.length, timestamp, timestamp).run();
    return result.meta.changes === 1;
  }
  async update(id: string, revision: number, name: string, key: string, members: Members, timestamp: string) {
    const result = await this.db.prepare(`UPDATE segments SET name=?,snapshot_key=?,student_name_count=?,student_id_count=?,sso_id_count=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
      .bind(name, key, members.student_name.length, members.student_id.length, members.sso_id.length, timestamp, id, revision).run();
    return result.meta.changes === 1;
  }
  async delete(id: string, revision: number) {
    try {
      const result = await this.db.prepare(`DELETE FROM segments WHERE id=? AND revision=?
        AND NOT EXISTS (SELECT 1 FROM app_versions v, json_each(v.segment_ids) ref WHERE ref.value=segments.id)`)
        .bind(id, revision).run();
      return result.meta.changes === 1;
    } catch (error) { if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) return false; throw error; }
  }
}
