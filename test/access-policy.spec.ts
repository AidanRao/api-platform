import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clean, migrate, read, request, segment } from "./segment-fixture";
import { emptyMembers, type Segment } from "../src/features/segments/schema";
import { accessPolicySchema, type AccessPolicy, type PolicyConfig } from "../src/domains/buaa-classhopper/access-policy/schema";
import { ADMIN_ACCESS_POLICY_PATH as admin, PUBLIC_ACCESS_POLICY_PATH as publicPath } from "../src/domains/buaa-classhopper/access-policy/routes";
import { ACCESS_POLICY_KEY, AccessPolicyRepository } from "../src/domains/buaa-classhopper/access-policy/repository";

beforeAll(migrate); beforeEach(clean);
const publicPolicy = () => request(publicPath, "GET", undefined, { "X-App-Version": "1.5.1" });
describe("segment-backed iClass whitelist", () => {
  it("returns empty policy by default, ignores legacy KV, and retains public version/cache rules", async () => {
    await env.API_PLATFORM_KV.put("buaa-classhopper:iclass:access-policy:v1", JSON.stringify({ names: ["legacy"] }));
    expect(await request(admin).then(read<PolicyConfig>)).toEqual({ revision: 1, segmentIds: [] });
    const response = await publicPolicy(); expect(response.headers.get("Cache-Control")).toBe("public, max-age=60"); expect(response.headers.get("Vary")).toBe("X-App-Version");
    expect(await read<AccessPolicy>(response)).toEqual({ schemaVersion: 1, revision: expect.any(String), studentIds: [], names: [] });
    expect((await request(publicPath)).status).toBe(400);
    expect((await request(publicPath, "GET", undefined, { "X-App-Version": "1.5.0" })).status).toBe(426);
    expect((await request(admin, "PATCH", { add: { names: ["old"] } })).status).toBe(405);
  });
  it("unions referenced members and changes public revision when a segment is edited", async () => {
    const a = await segment("a", { student_name: ["张三"], student_id: ["01"] });
    const b = await segment("b", { student_name: ["张三", "李四"], sso_id: ["user-1"] });
    const config = await request(admin, "PUT", { revision: 1, segmentIds: [a.id, b.id, a.id] }).then(read<PolicyConfig>);
    expect(await env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json")).toEqual(config);
    const tables = await env.API_PLATFORM_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'buaa_iclass_%'").all();
    expect(tables.results).toEqual([]);
    const before = await publicPolicy().then(read<AccessPolicy>);
    expect(before).toEqual({ schemaVersion: 1, revision: expect.any(String), studentIds: ["01"], names: ["张三", "李四"] });
    expect(accessPolicySchema.parse(before)).toEqual(before);
    expect(before).not.toHaveProperty("members"); expect(before).not.toHaveProperty("sso_id");
    expect((await publicPolicy().then(read<AccessPolicy>)).revision).toBe(before.revision);
    await request(`/api/admin/segments/${a.id}`, "PUT", { revision: 1, name: "a", members: { ...emptyMembers(), student_id: ["02"] } }).then(read<Segment>);
    const after = await publicPolicy().then(read<AccessPolicy>); expect(after.revision).not.toBe(before.revision); expect(after.studentIds).toEqual(["02"]);
    expect((await request(admin).then(read<PolicyConfig>)).revision).toBe(2);
  });
  it("rejects observed stale edits and validates references before writing KV", async () => {
    const a = await segment("a"), b = await segment("b");
    await request(admin, "PUT", { revision: 1, segmentIds: [a.id] }).then(read<PolicyConfig>);
    expect((await request(admin, "PUT", { revision: 1, segmentIds: [b.id] })).status).toBe(409);
    const committed = await request(admin).then(read<PolicyConfig>);
    expect((await request(admin, "PUT", { revision: 2, segmentIds: ["SEGM-20261024-AAAAAAAAAA"] })).status).toBe(503);
    expect(await request(admin).then(read<PolicyConfig>)).toEqual(committed);
  });
  it("fails closed for a deleted KV reference and permits replacing it with an empty selection", async () => {
    const s = await segment(); await request(admin, "PUT", { revision: 1, segmentIds: [s.id] }).then(read<PolicyConfig>);
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 })).status).toBe(200);
    expect((await publicPolicy()).status).toBe(503);
    expect((await request(admin).then(read<PolicyConfig>)).segmentIds).toEqual([s.id]);
    await request(admin, "PUT", { revision: 2, segmentIds: [] }).then(read<PolicyConfig>);
    expect(await publicPolicy().then(read<AccessPolicy>)).toEqual({ schemaVersion: 1, revision: expect.any(String), studentIds: [], names: [] });
  });
  it("returns 503 for corrupt configuration and KV read/write failures", async () => {
    await env.API_PLATFORM_KV.put(ACCESS_POLICY_KEY, "not-json");
    expect((await request(admin)).status).toBe(503); expect((await publicPolicy()).status).toBe(503);
    const kv = { get: vi.fn().mockRejectedValue(new Error("offline")), put: vi.fn().mockRejectedValue(new Error("offline")) };
    const repository = new AccessPolicyRepository(kv as unknown as KVNamespace);
    await expect(repository.get()).rejects.toMatchObject({ status: 503 });
    kv.get.mockResolvedValue(null);
    await expect(repository.replace(1, [])).rejects.toMatchObject({ status: 503 });
  });
  it("fails with 503 when an actively referenced segment snapshot cannot be read", async () => {
    const s = await segment(); await request(admin, "PUT", { revision: 1, segmentIds: [s.id] }).then(read<PolicyConfig>);
    await env.API_PLATFORM_DB.prepare("UPDATE segments SET snapshot_key=? WHERE id=?").bind(`missing:${crypto.randomUUID()}`, s.id).run();
    const response = await publicPolicy(); expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
