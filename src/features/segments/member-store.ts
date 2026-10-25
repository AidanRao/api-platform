import { ApiError } from "../../http/errors";
import { snapshotSchema, type Members } from "./schema";

export class SegmentMemberStore {
  constructor(private readonly kv: KVNamespace) {}
  async read(id: string, key: string): Promise<Members> {
    try {
      const value = snapshotSchema.safeParse(await this.kv.get(key, "json"));
      if (!value.success || value.data.segmentId !== id) throw new Error("Invalid snapshot");
      return value.data.members;
    } catch { throw new ApiError("人群名单暂时不可用，请稍后重试", 503); }
  }
  async write(id: string, members: Members) {
    const key = `segments:${id}:members:${crypto.randomUUID()}`;
    const value = JSON.stringify({ schemaVersion: 1, segmentId: id, members });
    if (new TextEncoder().encode(value).byteLength > 25 * 1024 * 1024) throw new ApiError("人群名单超过 KV 单值大小限制", 413);
    try { await this.kv.put(key, value); } catch { throw new ApiError("人群名单保存失败，请稍后重试", 503); }
    return key;
  }
}
