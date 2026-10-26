import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clean, migrate, read, request, segment } from "./segment-fixture";
import { emptyMembers, type Segment } from "../src/features/segments/schema";
import { accessPolicySchema, emptyPolicyConfig, type AccessPolicy, type PolicyConfig, type PolicyResult } from "../src/domains/buaa-classhopper/access-policy/schema";
import { ADMIN_ACCESS_POLICY_PATH as admin, PUBLIC_ACCESS_POLICY_PATH as publicPath } from "../src/domains/buaa-classhopper/access-policy/routes";
import { ACCESS_POLICY_KEY, AccessPolicyRepository } from "../src/domains/buaa-classhopper/access-policy/repository";
import { AccessPolicyService } from "../src/domains/buaa-classhopper/access-policy/service";

beforeAll(migrate); beforeEach(clean);
const selected = (...segmentIds: string[]): PolicyResult => ({ type: "segments", segmentIds });
const config = (result: PolicyResult, rules: PolicyConfig["rules"] = [], revision = 1): PolicyConfig => ({ revision, rules, default: result });
const save = (input: PolicyConfig) => request(admin, "PUT", input).then(read<PolicyConfig>);
const publicPolicy = (version = "1.5.1") => request(publicPath, "GET", undefined, { "X-App-Version": version });
const emptyPolicy = { schemaVersion: 1, revision: expect.any(String), studentIds: [], names: [] };

describe("version-configured iClass whitelist", () => {
  it("initializes an empty default, ignores legacy keys, and retains public cache headers", async () => {
    await env.API_PLATFORM_KV.put("buaa-classhopper:iclass:access-policy:v1", JSON.stringify({ names: ["legacy"] }));
    await env.API_PLATFORM_KV.put("buaa-classhopper:iclass:access-policy:v2", JSON.stringify({ revision: 9, segmentIds: ["legacy"] }));
    expect(await request(admin).then(read<PolicyConfig>)).toEqual(emptyPolicyConfig());
    const response = await publicPolicy("1.5.0");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60"); expect(response.headers.get("Vary")).toBe("X-App-Version");
    expect(await read<AccessPolicy>(response)).toEqual(emptyPolicy);
    expect((await request(admin, "PATCH", { add: { names: ["old"] } })).status).toBe(405);
    const tables = await env.API_PLATFORM_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'buaa_iclass_%'").all();
    expect(tables.results).toEqual([]);
  });

  it("selects exact versions independently and uses the configured default for every unmatched version", async () => {
    const a = await segment("a", { student_id: ["01"] }), b = await segment("b", { student_name: ["李四"] });
    const saved = await save(config(selected(b.id), [
      { version: "1.5.0", result: selected(a.id) },
      { version: "1.5.1", result: selected() },
      { version: "1.5.2", result: selected(a.id) },
      { version: "2.0.0", result: { type: "unavailable" } },
    ]));
    expect(await env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json")).toEqual(saved);
    const first = await publicPolicy("1.5.0").then(read<AccessPolicy>);
    expect(first.studentIds).toEqual(["01"]); expect(first.names).toEqual([]);
    expect(await publicPolicy().then(read<AccessPolicy>)).toEqual(emptyPolicy);
    expect((await publicPolicy("1.5.2").then(read<AccessPolicy>)).revision).not.toBe(first.revision);
    for (const version of ["0.0.1", "1.5.10", "3.0.0"]) {
      expect((await publicPolicy(version).then(read<AccessPolicy>)).names).toEqual(["李四"]);
    }
    const unavailable = await publicPolicy("2.0.0");
    expect(unavailable.status).toBe(426); expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({ code: 0, msg: "当前版本暂不可用", data: null });
  });

  it("returns a fixed empty policy for absent/invalid headers regardless of the default or broken storage", async () => {
    const s = await segment();
    await save(config({ type: "unavailable" }, [{ version: "1.5.1", result: selected(s.id) }]));
    expect((await publicPolicy("9.0.0")).status).toBe(426);
    const initial = await request(publicPath).then(read<AccessPolicy>);
    expect(initial).toEqual(emptyPolicy); expect(initial.revision).toMatch(/^[a-f0-9]{64}$/);
    for (const version of ["", "1.5", "01.5.1", "1.5.1-beta", "9007199254740992.0.0"]) {
      const response = await publicPolicy(version);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60"); expect(response.headers.get("Vary")).toBe("X-App-Version");
      expect(await read<AccessPolicy>(response)).toEqual(initial);
    }
    await save(config(selected(s.id), [], 2));
    expect(await request(publicPath).then(read<AccessPolicy>)).toEqual(initial);
    await env.API_PLATFORM_KV.put(ACCESS_POLICY_KEY, "not-json");
    expect(await request(publicPath).then(read<AccessPolicy>)).toEqual(initial);
    const repo = new AccessPolicyRepository(env.API_PLATFORM_KV), get = vi.spyOn(repo, "get");
    const load = vi.fn();
    expect(await new AccessPolicyService(repo, { load }).publicPolicy()).toEqual(initial);
    expect(get).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it("merges members and changes revision for configuration or selected Segment edits only", async () => {
    const a = await segment("a", { student_name: ["张三"], student_id: ["01"] });
    const b = await segment("b", { student_name: ["张三", "李四"], sso_id: ["user-1"] });
    const other = await segment("other");
    const saved = await save(config(selected(), [{ version: "1.5.1", result: selected(a.id, b.id, a.id) }, { version: "1.5.2", result: selected(other.id) }]));
    expect(saved.rules[0]!.result).toEqual(selected(...[a.id, b.id].sort()));
    const before = await publicPolicy().then(read<AccessPolicy>);
    expect(before).toEqual({ schemaVersion: 1, revision: expect.any(String), studentIds: ["01"], names: ["张三", "李四"] });
    expect(accessPolicySchema.parse(before)).toEqual(before);
    expect((await publicPolicy().then(read<AccessPolicy>)).revision).toBe(before.revision);
    await request(`/api/admin/segments/${other.id}`, "PUT", { revision: 1, name: "other", members: { ...emptyMembers(), student_id: ["99"] } }).then(read<Segment>);
    expect((await publicPolicy().then(read<AccessPolicy>)).revision).toBe(before.revision);
    await request(`/api/admin/segments/${a.id}`, "PUT", { revision: 1, name: "a", members: { ...emptyMembers(), student_id: ["02"] } }).then(read<Segment>);
    const after = await publicPolicy().then(read<AccessPolicy>);
    expect(after.revision).not.toBe(before.revision); expect(after.studentIds).toEqual(["02"]);
    await save(saved);
    expect((await publicPolicy().then(read<AccessPolicy>)).revision).not.toBe(after.revision);
  });

  it("rejects missing defaults, duplicate/invalid versions and invalid result shapes without writing", async () => {
    const unavailable = { type: "unavailable" };
    const valid = config(selected(), [{ version: "1.5.1", result: selected() }]);
    const invalid = [
      { revision: 1, rules: [] },
      { ...valid, rules: [...valid.rules, ...valid.rules] },
      ...["1.5", "01.5.1", "1.5.1-beta"].map((version) => ({ ...valid, rules: [{ version, result: unavailable }] })),
      { ...valid, default: { type: "segments" } },
      { ...valid, default: { type: "unavailable", segmentIds: [] } },
      { ...valid, rules: [{ version: "1.5.1", result: { type: "segments", segmentIds: ["bad-id"] } }] },
    ];
    for (const input of invalid) expect((await request(admin, "PUT", input)).status).toBe(400);
    expect(await request(admin).then(read<PolicyConfig>)).toEqual(emptyPolicyConfig());
    expect(await env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY)).toBeNull();
  });

  it("validates all references before writing and rejects observed stale edits", async () => {
    const a = await segment("a");
    const saved = await save(config(selected(a.id)));
    expect((await request(admin, "PUT", config(selected()))).status).toBe(409);
    const missing = selected("SEGM-20261024-AAAAAAAAAA");
    for (const input of [config(missing, [], 2), config(selected(), [{ version: "9.0.0", result: missing }], 2)]) {
      expect((await request(admin, "PUT", input)).status).toBe(503);
      expect(await request(admin).then(read<PolicyConfig>)).toEqual(saved);
    }
  });

  it("fails only requests selecting a deleted Segment and allows replacing broken references", async () => {
    const s = await segment();
    await save(config(selected(), [{ version: "1.5.1", result: selected(s.id) }, { version: "2.0.0", result: { type: "unavailable" } }]));
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 })).status).toBe(200);
    const broken = await publicPolicy(); expect(broken.status).toBe(503); expect(broken.headers.get("Cache-Control")).toBe("no-store");
    expect(await publicPolicy("1.5.2").then(read<AccessPolicy>)).toEqual(emptyPolicy);
    expect((await publicPolicy("2.0.0")).status).toBe(426);
    expect((await request(admin).then(read<PolicyConfig>)).rules[0]!.result).toEqual(selected(s.id));
    await save(config(selected(), [], 2));
    expect(await publicPolicy().then(read<AccessPolicy>)).toEqual(emptyPolicy);
  });

  it("returns 503 for corrupt configuration and KV read/write failures", async () => {
    for (const stored of ["not-json", JSON.stringify({ revision: 1, rules: [] })]) {
      await env.API_PLATFORM_KV.put(ACCESS_POLICY_KEY, stored);
      expect((await request(admin)).status).toBe(503); expect((await publicPolicy()).status).toBe(503);
    }
    const kv = { get: vi.fn().mockRejectedValue(new Error("offline")), put: vi.fn().mockRejectedValue(new Error("offline")) };
    const repository = new AccessPolicyRepository(kv as unknown as KVNamespace);
    await expect(repository.get()).rejects.toMatchObject({ status: 503 });
    kv.get.mockResolvedValue(null);
    await expect(repository.replace(emptyPolicyConfig())).rejects.toMatchObject({ status: 503 });
  });

  it("fails with 503 for an unreadable selected Segment snapshot without falling back", async () => {
    const s = await segment();
    await save(config(selected(), [{ version: "1.5.1", result: selected(s.id) }]));
    await env.API_PLATFORM_DB.prepare("UPDATE segments SET snapshot_key=? WHERE id=?").bind(`missing:${crypto.randomUUID()}`, s.id).run();
    const response = await publicPolicy(); expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await publicPolicy("1.5.2").then(read<AccessPolicy>)).toEqual(emptyPolicy);
    expect((await request(admin, "PUT", config(selected(s.id), [], 2))).status).toBe(503);
  });
});
