import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app, apps, clean, migrate, now, read, request, segment } from "./segment-fixture";
import { emptyMembers, matchesMembers, mergeMembers, segmentInputSchema, type Segment } from "../src/features/segments/schema";
import { SegmentRepository } from "../src/features/segments/repository";
import { SegmentMemberStore } from "../src/features/segments/member-store";
import { createApp } from "../src/app";
import { ApiError } from "../src/http/errors";
import { defineApps, isAdminPage } from "../src/apps/registry";

beforeAll(migrate); beforeEach(clean); afterEach(() => vi.restoreAllMocks());
describe("shared segments", () => {
  it("normalizes independent lists and matches any exact field", () => {
    const value = segmentInputSchema.parse({ name: " 人群 ", members: { student_name: [" 张三 ", "张三"], student_id: ["01"], sso_id: ["Alice"] } });
    expect(value.name).toBe("人群"); expect(value.members.student_name).toEqual(["张三"]);
    expect(matchesMembers(value.members, { student_name: "张三", student_id: "wrong" })).toBe(true);
    expect(matchesMembers(value.members, { student_id: "01" })).toBe(true);
    expect(matchesMembers(value.members, { sso_id: "Alice" })).toBe(true);
    expect(matchesMembers(value.members, { sso_id: "alice" })).toBe(false);
    expect(matchesMembers(value.members, {})).toBe(false);
    expect(mergeMembers([{ members: value.members }, { members: value.members }])).toEqual(value.members);
    expect(segmentInputSchema.safeParse({ ...value, description: "unsupported" }).success).toBe(false);
  });
  it("stores identities only in KV and exposes summaries without internal snapshot keys", async () => {
    const s = await segment("共享人群", { student_name: ["张三", "张三"], student_id: ["01"], sso_id: ["user-1"] });
    expect(s.counts).toEqual({ student_name: 1, student_id: 1, sso_id: 1 });
    const stored = await env.API_PLATFORM_DB.prepare("SELECT * FROM segments WHERE id=?").bind(s.id).first();
    expect(JSON.stringify(stored)).not.toContain("user-1"); expect(stored).not.toHaveProperty("description");
    const snapshot = await env.API_PLATFORM_KV.get(String(stored!.snapshot_key), "json");
    expect(snapshot).toMatchObject({ segmentId: s.id, members: { sso_id: ["user-1"] } });
    const response = await request("/api/admin/segments?search=共享"); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const list = await read<{ items: Record<string, unknown>[]; total: number }>(response);
    expect(list.total).toBe(1); expect(list.items[0]).not.toHaveProperty("snapshotKey"); expect(list.items[0]).not.toHaveProperty("members");
    expect((await request(`/api/admin/segments/${s.id}/references`)).status).toBe(404);
    expect(isAdminPage(`/admin/segments/${s.id}`, apps)).toBe(true);
    expect(() => defineApps([{ id: "segments", name: "reserved" }])).toThrow();
  });
  it("rejects old fields and protects every segment endpoint with Access", async () => {
    expect((await request("/api/admin/segments", "POST", { name: "x", description: "no", members: emptyMembers() })).status).toBe(400);
    const denied = createApp(async () => { throw new ApiError("禁止访问", 403); }, now, apps);
    expect((await denied.request("https://test/api/admin/segments", {}, env)).status).toBe(403);
    expect((await app.request("https://test/api/admin/segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }, env)).status).toBe(400);
  });
  it("publishes one complete snapshot when updates race", async () => {
    const s = await segment();
    const results = await Promise.all(["one", "two"].map((id) => request(`/api/admin/segments/${s.id}`, "PUT", { revision: 1, name: id, members: { ...emptyMembers(), sso_id: [id] } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await request(`/api/admin/segments/${s.id}`).then(read<Segment>);
    expect(current.members.sso_id).toEqual([current.name]); expect(current.revision).toBe(2); expect(current.counts.sso_id).toBe(1);
  });
  it("keeps committed metadata when KV writes fail and rejects missing or invalid snapshots", async () => {
    const s = await segment();
    vi.spyOn(SegmentMemberStore.prototype, "write").mockRejectedValueOnce(new ApiError("人群名单保存失败", 503));
    expect((await request(`/api/admin/segments/${s.id}`, "PUT", { revision: 1, name: "changed", members: emptyMembers() })).status).toBe(503);
    const repo = new SegmentRepository(env.API_PLATFORM_DB), row = (await repo.get(s.id))!;
    expect(row.name).toBe(s.name); expect(row.revision).toBe(1);
    await env.API_PLATFORM_DB.prepare("UPDATE segments SET snapshot_key=? WHERE id=?").bind(`missing:${crypto.randomUUID()}`, s.id).run();
    expect((await request(`/api/admin/segments/${s.id}`)).status).toBe(503);
    const bad = `invalid:${crypto.randomUUID()}`; await env.API_PLATFORM_KV.put(bad, "not-json");
    await expect(new SegmentMemberStore(env.API_PLATFORM_KV).read(s.id, bad)).rejects.toMatchObject({ status: 503 });
  });
  it("honors foreign keys from a future consumer without adding a consumer registry", async () => {
    const s = await segment();
    await env.API_PLATFORM_DB.prepare("CREATE TABLE future_segment_use(segment_id TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE RESTRICT)").run();
    try {
      await env.API_PLATFORM_DB.prepare("INSERT INTO future_segment_use VALUES(?)").bind(s.id).run();
      const response = await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: s.revision }); expect(response.status).toBe(409);
      expect(await response.text()).not.toContain("future_segment_use");
      await env.API_PLATFORM_DB.prepare("DELETE FROM future_segment_use").run();
      expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: s.revision + 1 })).status).toBe(409);
      expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: s.revision })).status).toBe(200);
    } finally { await env.API_PLATFORM_DB.prepare("DROP TABLE future_segment_use").run(); }
  });
});
