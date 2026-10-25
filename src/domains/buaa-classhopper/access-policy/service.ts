import { ApiError } from "../../../http/errors";
import { mergeMembers, type SegmentReader } from "../../../features/segments/schema";
import { AccessPolicyRepository } from "./repository";
import type { AccessPolicy, PolicyConfig } from "./schema";

export class AccessPolicyService {
  constructor(readonly repo: AccessPolicyRepository, private readonly segments: SegmentReader) {}
  async replace(input: PolicyConfig) {
    if ((await this.repo.get()).revision !== input.revision) throw new ApiError("配置已变化，请刷新核对后重试", 409);
    await this.segments.load(input.segmentIds);
    return this.repo.replace(input.revision, input.segmentIds);
  }
  async publicPolicy(): Promise<AccessPolicy> {
    const config = await this.repo.get(), segments = await this.segments.load(config.segmentIds);
    const fingerprint = JSON.stringify([config.revision, segments.map((s) => [s.id, s.revision]).sort(([a], [b]) => String(a).localeCompare(String(b)))]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
    const revision = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
    const { student_name, student_id } = mergeMembers(segments);
    return { schemaVersion: 1, revision, studentIds: student_id, names: student_name };
  }
}
