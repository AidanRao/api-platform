import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { AccessPolicy } from "../src/domains/buaa-classhopper/access-policy.schema";
import {
  ACCESS_POLICY_KEY,
  readAccessPolicy,
  writeAccessPolicy,
} from "../src/domains/buaa-classhopper/access-policy.repository";

const policy: AccessPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001", "ZY370002"],
  names: ["张三", "李四"],
};

describe("access policy repository", () => {
  beforeEach(async () => {
    await env.API_PLATFORM_KV.delete(ACCESS_POLICY_KEY);
  });

  it("returns null when KV has not been initialized", async () => {
    await expect(readAccessPolicy(env.API_PLATFORM_KV)).resolves.toBeNull();
  });

  it("writes and reads a validated policy", async () => {
    await writeAccessPolicy(env.API_PLATFORM_KV, policy);
    await expect(readAccessPolicy(env.API_PLATFORM_KV)).resolves.toEqual(policy);
  });

  it("rejects invalid stored data", async () => {
    await env.API_PLATFORM_KV.put(
      ACCESS_POLICY_KEY,
      JSON.stringify({ ...policy, schemaVersion: 2 }),
    );

    await expect(readAccessPolicy(env.API_PLATFORM_KV)).rejects.toThrow(
      "KV access policy is invalid",
    );
  });

  it("rejects a stored policy with an invalid revision date", async () => {
    await env.API_PLATFORM_KV.put(
      ACCESS_POLICY_KEY,
      JSON.stringify({ ...policy, revision: "2026-02-30-001" }),
    );

    await expect(readAccessPolicy(env.API_PLATFORM_KV)).rejects.toThrow(
      "KV access policy is invalid",
    );
  });
});
