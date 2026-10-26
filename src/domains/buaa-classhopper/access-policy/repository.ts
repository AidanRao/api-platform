import { ApiError } from "../../../http/errors";
import { emptyPolicyConfig, policyConfigSchema, type PolicyConfig } from "./schema";

export const ACCESS_POLICY_KEY = "buaa-classhopper:iclass:access-policy:v4";

export class AccessPolicyRepository {
  constructor(private readonly kv: KVNamespace) {}

  async get(): Promise<PolicyConfig> {
    try {
      const stored = await this.kv.get<unknown>(ACCESS_POLICY_KEY, "json");
      if (stored === null) return emptyPolicyConfig();
      return policyConfigSchema.parse(stored);
    } catch {
      throw new ApiError("白名单配置暂时不可用", 503);
    }
  }

  // KV offers no atomic compare-and-set. This detects observed stale edits only.
  async replace(input: PolicyConfig): Promise<PolicyConfig> {
    if ((await this.get()).revision !== input.revision) throw new ApiError("配置已变化，请刷新核对后重试", 409);
    const config = { ...input, revision: input.revision + 1 };
    try {
      await this.kv.put(ACCESS_POLICY_KEY, JSON.stringify(config));
    } catch {
      throw new ApiError("白名单配置保存失败，请稍后重试", 503);
    }
    return config;
  }
}
