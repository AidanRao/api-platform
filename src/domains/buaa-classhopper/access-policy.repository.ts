import {
  accessPolicySchema,
  type AccessPolicy,
  formatAccessPolicyIssues,
} from "./access-policy.schema";

export const ACCESS_POLICY_KEY =
  "buaa-classhopper:iclass:access-policy:v1";

export async function readAccessPolicy(
  kv: KVNamespace,
): Promise<AccessPolicy | null> {
  const stored = await kv.get<unknown>(ACCESS_POLICY_KEY, "json");
  if (stored === null) {
    return null;
  }

  const result = accessPolicySchema.safeParse(stored);
  if (!result.success) {
    throw new Error(
      `KV access policy is invalid: ${formatAccessPolicyIssues(result.error.issues).join("; ")}`,
    );
  }
  return result.data;
}

export async function writeAccessPolicy(
  kv: KVNamespace,
  policy: AccessPolicy,
): Promise<void> {
  await kv.put(ACCESS_POLICY_KEY, JSON.stringify(policy));
}
