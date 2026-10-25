import { ApiError } from "../../http/errors";
import { generatePublicId } from "../../infrastructure/public-id";
import { SegmentRepository } from "./repository";
import { SegmentMemberStore } from "./member-store";
import type { Segment, SegmentInput, SegmentReader, StoredSegment } from "./schema";

export class SegmentService implements SegmentReader {
  constructor(readonly repo: SegmentRepository, private readonly store: SegmentMemberStore, private readonly now: () => Date) {}
  private async resolve({ snapshotKey, ...summary }: StoredSegment): Promise<Segment> {
    return { ...summary, members: await this.store.read(summary.id, snapshotKey) };
  }
  async load(ids: readonly string[]): Promise<Segment[]> {
    const unique = [...new Set(ids)].sort(), rows = await this.repo.getMany(unique);
    if (rows.length !== unique.length) throw new ApiError("引用的人群不存在，请刷新配置", 503);
    return Promise.all(rows.map((r) => this.resolve(r)));
  }
  async get(id: string) {
    const row = await this.repo.get(id);
    if (!row) throw new ApiError("人群不存在", 404);
    return this.resolve(row);
  }
  async create(input: SegmentInput) {
    const date = this.now(), id = generatePublicId("SEGM", date, "Asia/Shanghai"), timestamp = date.toISOString();
    const key = await this.store.write(id, input.members);
    if (!await this.repo.create(id, input.name, key, input.members, timestamp)) throw new ApiError("人群 ID 冲突，请重试", 409);
    return { id, name: input.name, members: input.members, counts: this.counts(input), revision: 1, createdAt: timestamp, updatedAt: timestamp };
  }
  async update(id: string, revision: number, input: SegmentInput) {
    const row = await this.repo.get(id);
    if (!row) throw new ApiError("人群不存在", 404);
    if (row.revision !== revision) throw new ApiError("人群已被修改，请刷新核对后重试", 409);
    const key = await this.store.write(id, input.members), timestamp = this.now().toISOString();
    if (!await this.repo.update(id, revision, input.name, key, input.members, timestamp)) throw new ApiError("人群已被修改，请刷新核对后重试", 409);
    return { id, name: input.name, members: input.members, counts: this.counts(input), revision: revision + 1, createdAt: row.createdAt, updatedAt: timestamp };
  }
  async delete(id: string, revision: number) {
    if (!await this.repo.get(id)) throw new ApiError("人群不存在", 404);
    if (!await this.repo.delete(id, revision)) throw new ApiError("无法删除：人群被引用或记录已变化", 409);
  }
  private counts({ members }: SegmentInput) { return { student_name: members.student_name.length, student_id: members.student_id.length, sso_id: members.sso_id.length }; }
}
export function createSegmentService(db: D1Database, kv: KVNamespace, now: () => Date) {
  return new SegmentService(new SegmentRepository(db), new SegmentMemberStore(kv), now);
}
