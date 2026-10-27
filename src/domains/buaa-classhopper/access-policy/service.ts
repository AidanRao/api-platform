import { ApiError } from "../../../http/errors";
import { mergeMembers, type SegmentReader } from "../../../features/segments/schema";
import { AccessPolicyRepository } from "./repository";
import { parseAppVersion } from "./app-version";
import type { AccessPolicy, PolicyConfig } from "./schema";

export class AccessPolicyService {
  constructor(readonly repo: AccessPolicyRepository, private readonly segments: SegmentReader) {}
  async replace(input: PolicyConfig) {
    if ((await this.repo.get()).revision !== input.revision) throw new ApiError("配置已变化，请刷新核对后重试", 409);
    const defaults = [input.default.unmatched, input.default.invalidVersion];
    await this.segments.load([...new Set([...input.rules.flatMap((rule) => rule.segmentIds),
      ...defaults.flatMap((result) => result.type === "segments" ? result.segmentIds : [])])]);
    return this.repo.replace(input);
  }
  async publicPolicy(header?: string): Promise<AccessPolicy> {
    const version = parseAppVersion(header);
    const config = await this.repo.get();
    const rule = version === null ? undefined : config.rules.find((rule) => rule.version === version);
    const result = version === null ? config.default.invalidVersion : rule ? { type: "segments" as const, segmentIds: rule.segmentIds } : config.default.unmatched;
    if (result.type === "unavailable") throw new ApiError("当前版本暂不可用", 426);
    const segments = result.type === "segments" ? await this.segments.load(result.segmentIds) : [];
    const revision = await fingerprint(["access-policy:v4", config.revision, version === null ? "invalid-version" : rule?.version ?? "unmatched-version", result.type,
      segments.map((s) => [s.id, s.revision]).sort(([a], [b]) => String(a).localeCompare(String(b)))]);
    const { student_name, student_id } = mergeMembers(segments);
    return { schemaVersion: 1, revision, studentIds: student_id, names: student_name };
  }
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
