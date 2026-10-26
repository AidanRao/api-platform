import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clean, migrate, read, request, segment } from "./segment-fixture";
import { emptyMembers, type Segment } from "../src/features/segments/schema";
import { versionNumberSchema, type AppVersion, type Settings } from "../src/features/versions/schema";
import { VersionRepository } from "../src/features/versions/repository";
import { PUBLIC_ACCESS_POLICY_PATH, ADMIN_ACCESS_POLICY_PATH } from "../src/domains/buaa-classhopper/access-policy/routes";
import type { AccessPolicy } from "../src/domains/buaa-classhopper/access-policy/schema";

const base = (app = "buaa-classhopper") => `/api/admin/${app}/versions`;
const pub = (app = "buaa-classhopper") => `/api/${app}/versions/latest`;
const pkg = { downloadUrl: "https://cdn.test/app.apk", downloadSizeBytes: 100, sha256: "a".repeat(64) };
const code = (v: string) => v.split(".").reduce((n, part) => n * 1000 + Number(part), 0);
const create = (version = "1.4.1", app?: string, extra = {}) => request(base(app), "POST", { version, versionCode: code(version), ...extra }).then(read<AppVersion>);
const get = (version = "1.4.1", app?: string) => request(`${base(app)}/${version}`).then(read<AppVersion>);
const promote = async (version: string) => request(`${base()}/${version}`, "PATCH", { revision: (await get(version)).revision, releaseType: "full" }).then(read<AppVersion>);
const latest = async (version: string | null, app?: string) => {
  const state = await request(`${base(app)}/latest`).then(read<Settings>);
  return request(`${base(app)}/latest`, "PUT", { revision: state.revision, version }).then(read<Settings>);
};
const associate = async (version: string, ids: string[], app?: string) => request(`${base(app)}/${version}/segments`, "PUT", { revision: (await get(version, app)).revision, segmentIds: ids }).then(read<AppVersion>);
const resolve = (app = "buaa-classhopper", authenticated = false) => request(pub(app), "GET", undefined, authenticated ? { Authorization: `Bearer valid-${app}` } : {}).then(read<{ version: { version: string; versionCode: number; releaseNotes: string; packageInfo: typeof pkg | null } | null }>);
beforeAll(migrate); beforeEach(clean);

describe("segment-backed application versions", () => {
  it("creates and edits metadata with segment references in one revision", async () => {
    const a = await segment("内测 A", { sso_id: ["user-1"] }), b = await segment("内测 B");
    const created = await create("1.4.1", undefined, { releaseNotes: "初始说明", segmentIds: [a.id, a.id] });
    expect(created).toMatchObject({ releaseType: "gray", segmentIds: [a.id], revision: 1 });
    expect((await resolve(undefined, true)).version?.version).toBe("1.4.1");
    const updated = await request(`${base()}/1.4.1`, "PATCH", { revision: 1, releaseNotes: "新的说明", packageInfo: pkg, segmentIds: [b.id] }).then(read<AppVersion>);
    expect(updated).toMatchObject({ releaseNotes: "新的说明", packageInfo: pkg, segmentIds: [b.id], revision: 2 });
    expect(await resolve(undefined, true)).toEqual({ version: null });
    const edited = await request(`${base()}/1.4.1`, "PATCH", { revision: 2, packageInfo: { ...pkg, downloadSizeBytes: 200 } }).then(read<AppVersion>);
    expect(edited.segmentIds).toEqual([b.id]);
    const cleared = await request(`${base()}/1.4.1`, "PATCH", { revision: 3, segmentIds: [] }).then(read<AppVersion>);
    expect(cleared).toMatchObject({ segmentIds: [], revision: 4 });
  });
  it("stores package JSON, replaces it atomically, clears it and validates actual numeric version codes", async () => {
    const saved = await create("9.0.0", undefined, { versionCode: 2, packageInfo: { ...pkg, sha256: "A".repeat(64) } });
    expect(saved.packageInfo).toEqual(pkg);
    const row = await env.API_PLATFORM_DB.prepare("SELECT version_code,package_info FROM app_versions WHERE version='9.0.0'").first<{ version_code: number; package_info: string }>();
    expect(row?.version_code).toBe(2); expect(JSON.parse(row!.package_info)).toEqual(pkg);
    const columns = await env.API_PLATFORM_DB.prepare("PRAGMA table_info(app_versions)").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).not.toContain("download_url");
    for (const value of [0, -1, 1.5, "3", null, 2100000001]) {
      expect((await request(base(), "POST", { version: "3.0.0", versionCode: value })).status).toBe(400);
    }
    expect((await request(base(), "POST", { version: "3.0.0" })).status).toBe(400);
    for (const packageInfo of [{}, { downloadUrl: pkg.downloadUrl }, { ...pkg, sha256: "bad" }, { ...pkg, downloadSizeBytes: 0 }, { ...pkg, versionCode: 3 }]) {
      expect((await request(`${base()}/9.0.0`, "PATCH", { revision: 1, packageInfo })).status).toBe(400);
    }
    const replacement = { ...pkg, downloadSizeBytes: 200 };
    expect((await request(`${base()}/9.0.0`, "PATCH", { revision: 1, packageInfo: replacement }).then(read<AppVersion>)).packageInfo).toEqual(replacement);
    expect((await request(`${base()}/9.0.0`, "PATCH", { revision: 1, packageInfo: null })).status).toBe(409);
    expect((await request(`${base()}/9.0.0`, "PATCH", { revision: 2, packageInfo: null }).then(read<AppVersion>)).packageInfo).toBeNull();
  });
  it("selects full and gray releases by versionCode rather than display version", async () => {
    await create("9.0.0", undefined, { versionCode: 2, releaseType: "full" }); await latest("9.0.0");
    const s = await segment("内测", { sso_id: ["user-1"] });
    await create("1.0.0", undefined, { versionCode: 3, segmentIds: [s.id] });
    expect((await resolve()).version).toMatchObject({ version: "9.0.0", versionCode: 2 });
    expect((await resolve(undefined, true)).version).toMatchObject({ version: "1.0.0", versionCode: 3 });
  });
  it("leaves the entire version unchanged if combined segment validation fails", async () => {
    const s = await segment(), missing = "SEGM-20261024-AAAAAAAAAA";
    expect((await request(base(), "POST", { versionCode: 1, version: "1.4.1", releaseNotes: "不能保存", segmentIds: [missing] })).status).toBe(409);
    expect((await request(`${base()}/1.4.1`)).status).toBe(404);
    const created = await create("1.4.1", undefined, { releaseNotes: "原始说明", segmentIds: [s.id] });
    expect((await request(`${base()}/1.4.1`, "PATCH", { revision: 1, releaseNotes: "不能保存", segmentIds: [s.id, missing] })).status).toBe(409);
    expect(await get()).toEqual(created);
    expect((await request(base(), "POST", { versionCode: 1, version: "1.5.0", releaseType: "full", segmentIds: [s.id] })).status).toBe(400);
    const full = await promote("1.4.1");
    expect((await request(`${base()}/1.4.1`, "PATCH", { revision: full.revision, releaseNotes: "不能保存", segmentIds: [s.id] })).status).toBe(409);
    expect(await get()).toEqual(full);
    expect((await request(`${base()}/1.4.1`, "PATCH", { revision: full.revision - 1, releaseType: "gray", releaseNotes: "过期编辑", segmentIds: [s.id] })).status).toBe(409);
    expect(await get()).toEqual(full);
    const gray = await request(`${base()}/1.4.1`, "PATCH", { revision: full.revision, releaseType: "gray", segmentIds: [s.id] }).then(read<AppVersion>);
    expect(gray).toMatchObject({ releaseType: "gray", segmentIds: [s.id], revision: full.revision + 1 });
  });
  it("serializes creating a version with references against segment deletion", async () => {
    const s = await segment();
    const [created, removed] = await Promise.all([
      request(base(), "POST", { versionCode: 1, version: "1.4.1", segmentIds: [s.id] }),
      request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 }),
    ]);
    const stored = await new VersionRepository(env.API_PLATFORM_DB, "buaa-classhopper").get("1.4.1");
    if (created.status === 201) {
      expect(removed.status).toBe(409); expect(stored?.segmentIds).toEqual([s.id]);
    } else {
      expect(created.status).toBe(409); expect(removed.status).toBe(200); expect(stored).toBeNull();
    }
  });
  it("defaults to gray, validates release types, and limits latest and segment settings by type", async () => {
    const gray = await create(); expect(gray.releaseType).toBe("gray");
    expect(await resolve()).toEqual({ version: null });
    expect((await request(`${base()}/latest`, "PUT", { revision: 1, version: gray.version })).status).toBe(409);
    expect(await request(`${base()}/latest`).then(read<Settings>)).toEqual({ latestVersion: null, revision: 1 });
    const full = await create("1.5.0", undefined, { releaseType: "full" });
    expect(full.releaseType).toBe("full"); expect(full.segmentIds).toEqual([]);
    const s = await segment();
    for (const ids of [[], [s.id]]) {
      expect((await request(`${base()}/1.5.0/segments`, "PUT", { revision: 1, segmentIds: ids })).status).toBe(409);
    }
    expect(await get("1.5.0")).toEqual(full);
    await latest("1.5.0"); expect((await resolve()).version?.version).toBe("1.5.0");
    expect((await request(`${base()}/1.5.0`, "PATCH", { revision: 1, releaseType: "gray" })).status).toBe(409);
    expect(await get("1.5.0")).toEqual(full);
    await latest(null);
    expect((await request(`${base()}/1.5.0`, "PATCH", { revision: 1, releaseType: "gray" }).then(read<AppVersion>)).releaseType).toBe("gray");
    expect((await associate("1.5.0", [s.id])).segmentIds).toEqual([s.id]);
    for (const releaseType of ["stable", "", null]) {
      expect((await request(base(), "POST", { versionCode: 1, version: "2.0.0", releaseType })).status).toBe(400);
      expect((await request(`${base()}/1.4.1`, "PATCH", { revision: 1, releaseType })).status).toBe(400);
    }
  });
  it("promotes atomically, drops segment references, and rejects an older segment draft", async () => {
    await create(); const s = await segment("内测", { sso_id: ["user-1"] });
    await associate("1.4.1", [s.id]);
    expect((await resolve(undefined, true)).version?.version).toBe("1.4.1");
    const full = await promote("1.4.1");
    expect(full).toMatchObject({ releaseType: "full", segmentIds: [], revision: 3 });
    expect(await resolve(undefined, true)).toEqual({ version: null });
    expect((await request(`${base()}/1.4.1/segments`, "PUT", { revision: 2, segmentIds: [s.id] })).status).toBe(409);
    expect(await get()).toEqual(full);
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 })).status).toBe(200);
    await latest("1.4.1"); expect((await resolve()).version?.version).toBe("1.4.1");
  });
  it("guards repository writes without database checks or triggers", async () => {
    await create(); const s = await segment();
    const db = env.API_PLATFORM_DB, repository = new VersionRepository(db, "buaa-classhopper");
    const tables = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('segments','app_versions','app_version_settings')").all<{ sql: string }>();
    expect(tables.results).toHaveLength(3);
    for (const table of tables.results) expect(table.sql).not.toMatch(/\bCHECK\s*\(/i);
    expect(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).toMatchObject({ results: [] });
    expect(await repository.setLatest("1.4.1", 1)).toBe(false);
    expect(await repository.setLatest("9.9.9", 1)).toBe(false);
    const full = await promote("1.4.1");
    expect(await repository.setSegments("1.4.1", full.revision, [s.id], "now")).toBe(false);
    expect(await repository.setSegments("1.4.1", full.revision, [], "now")).toBe(false);
    await latest("1.4.1");
    expect(await repository.update("1.4.1", full.revision, { ...full, releaseType: "gray" }, "now")).toBeNull();
    expect(await get()).toEqual(full);
  });
  it("serializes setting latest against changing a full version to gray", async () => {
    const full = await create("1.4.1", undefined, { releaseType: "full" });
    const repository = new VersionRepository(env.API_PLATFORM_DB, "buaa-classhopper");
    const [assigned, demoted] = await Promise.all([
      repository.setLatest(full.version, 1),
      repository.update(full.version, 1, { ...full, releaseType: "gray" }, "2026-10-24T01:00:00Z"),
    ]);
    expect(Number(assigned) + Number(demoted !== null)).toBe(1);
    const stored = await get(), settings = await repository.settings();
    expect(settings.latestVersion).toBe(stored.releaseType === "full" ? stored.version : null);
  });
  it("serializes promotion against segment assignment with the same revision", async () => {
    await create(); const s = await segment();
    const [promoted, assigned] = await Promise.all([
      request(`${base()}/1.4.1`, "PATCH", { revision: 1, releaseType: "full" }),
      request(`${base()}/1.4.1/segments`, "PUT", { revision: 1, segmentIds: [s.id] }),
    ]);
    expect([promoted.status, assigned.status].sort()).toEqual([200, 409]);
    const stored = await get();
    expect(stored.revision).toBe(2);
    expect(stored.segmentIds).toEqual(stored.releaseType === "full" ? [] : [s.id]);
  });
  it("stores segment IDs as one version JSON array and rejects invalid references without changing the row", async () => {
    expect((await create()).segmentIds).toEqual([]);
    const a = await segment("a"), b = await segment("b"), ids = [a.id, b.id].sort();
    const saved = await request(`${base()}/1.4.1/segments`, "PUT", { revision: 1, segmentIds: [b.id, a.id, b.id] }).then(read<AppVersion>);
    expect(saved.segmentIds).toEqual(ids); expect(saved.revision).toBe(2);
    const stored = await env.API_PLATFORM_DB.prepare("SELECT segment_ids FROM app_versions WHERE app_id=? AND version=?").bind("buaa-classhopper", "1.4.1").first<{ segment_ids: string }>();
    expect(JSON.parse(stored!.segment_ids)).toEqual(ids);
    expect(await env.API_PLATFORM_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_version_segments'").first()).toBeNull();
    for (const segmentIds of ["not-json", {}, null, [1], ["unknown"], Array(101).fill(a.id)]) {
      expect((await request(`${base()}/1.4.1/segments`, "PUT", { revision: 2, segmentIds })).status).toBe(400);
    }
    expect(await get()).toEqual(saved);
    const edited = await request(`${base()}/1.4.1`, "PATCH", { revision: 2, releaseNotes: "说明变更" }).then(read<AppVersion>);
    expect(edited.segmentIds).toEqual(ids); expect(edited.revision).toBe(3);
  });
  it("applies a shared membership edit to both whitelist and version consumers without rewriting references", async () => {
    const s = await segment("共享", { student_id: ["01"], sso_id: ["user-1"] });
    await create(); await associate("1.4.1", [s.id]);
    await request(ADMIN_ACCESS_POLICY_PATH, "PUT", { revision: 1, rules: [], default: { unmatched: { type: "segments", segmentIds: [s.id] }, invalidVersion: { type: "segments", segmentIds: [] } } }).then(read);
    const before = await request(PUBLIC_ACCESS_POLICY_PATH, "GET", undefined, { "X-App-Version": "1.5.1" }).then(read<AccessPolicy>);
    expect((await resolve(undefined, true)).version?.version).toBe("1.4.1");
    await request(`/api/admin/segments/${s.id}`, "PUT", { revision: 1, name: s.name, members: { ...emptyMembers(), student_id: ["02"] } }).then(read<Segment>);
    const after = await request(PUBLIC_ACCESS_POLICY_PATH, "GET", undefined, { "X-App-Version": "1.5.1" }).then(read<AccessPolicy>);
    expect(after.studentIds).toEqual(["02"]); expect(after.revision).not.toBe(before.revision);
    expect(await resolve(undefined, true)).toEqual({ version: null }); expect((await get()).segmentIds).toEqual([s.id]);
  });
  it("validates canonical version numbers, numeric ordering and optimistic metadata edits", async () => {
    for (const s of ["01.0.0", "1.0", "1.0.0-beta", "9007199254740992.0.0"]) expect(versionNumberSchema.safeParse(s).success).toBe(false);
    await create("1.9.99", undefined, { versionCode: 100 }); await create("1.10.0", undefined, { versionCode: 99, releaseType: "full" });
    const page = await request(`${base()}?pageSize=1`).then(read<{ items: AppVersion[]; total: number }>); expect(page.items[0]?.version).toBe("1.9.99"); expect(page.total).toBe(2);
    expect((await request(base(), "POST", { versionCode: 1, version: "1.10.0" })).status).toBe(409);
    await latest("1.10.0");
    await request(`${base()}/1.10.0`, "PATCH", { revision: 1, releaseNotes: "**修复**", packageInfo: { ...pkg, downloadUrl: "https://cdn.test/a.apk", downloadSizeBytes: 200 } }).then(read<AppVersion>);
    expect((await resolve()).version?.releaseNotes).toBe("**修复**");
    expect((await request(`${base()}/1.10.0`, "PATCH", { revision: 1, releaseNotes: "stale" })).status).toBe(409);
    expect((await request(`${base()}/1.10.0`, "PATCH", { revision: 2, version: "2.0.0" })).status).toBe(400);
    expect((await request(base(), "POST", { versionCode: 1, version: "3.0.0", packageInfo: { ...pkg, downloadUrl: "javascript:alert(1)" } })).status).toBe(400);
  });
  it("uses only SSO IDs and selects the highest version across all matching segments", async () => {
    for (const v of ["1.4.1", "1.5.0", "1.6.0", "1.7.0"]) await create(v);
    const s = await segment("SSO", { sso_id: ["user-1"] }), names = await segment("姓名", { student_name: ["user-1"], student_id: ["user-1"] });
    await associate("1.5.0", [s.id]); await associate("1.6.0", [s.id]); await associate("1.7.0", [names.id]);
    expect(await resolve()).toEqual({ version: null }); expect((await resolve(undefined, true)).version?.version).toBe("1.6.0");
    await promote("1.4.1"); await latest("1.4.1"); expect((await resolve()).version?.version).toBe("1.4.1");
    expect((await resolve(undefined, true)).version?.version).toBe("1.6.0");
    await promote("1.6.0"); await latest("1.6.0"); expect((await resolve(undefined, true)).version?.version).toBe("1.6.0");
    await promote("1.7.0"); await latest("1.7.0"); expect((await resolve(undefined, true)).version?.version).toBe("1.7.0");
    await latest(null); expect((await resolve(undefined, true)).version?.version).toBe("1.5.0");
  });
  it("shares one segment across apps while keeping version settings isolated, and follows membership edits", async () => {
    const s = await segment("共享", { sso_id: ["user-1"] });
    await create("1.4.1"); await create("2.0.0", "second_app");
    await associate("1.4.1", [s.id]); await associate("2.0.0", [s.id], "second_app");
    expect((await resolve(undefined, true)).version?.version).toBe("1.4.1"); expect((await resolve("second_app", true)).version?.version).toBe("2.0.0");
    await request(`/api/admin/segments/${s.id}`, "PUT", { revision: 1, name: s.name, members: { ...emptyMembers(), sso_id: ["different-user"] } }).then(read<Segment>);
    expect(await resolve(undefined, true)).toEqual({ version: null }); expect(await resolve("second_app", true)).toEqual({ version: null });
    expect((await get()).segmentIds).toEqual([s.id]);
    await associate("1.4.1", []);
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 2 })).status).toBe(409);
    await associate("2.0.0", [], "second_app");
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 2 })).status).toBe(200);
  });
  it("atomically replaces references, with stale or missing targets leaving committed references untouched", async () => {
    await create(); const a = await segment("a"), b = await segment("b");
    const results = await Promise.all([a.id, b.id].map((id) => request(`${base()}/1.4.1/segments`, "PUT", { revision: 1, segmentIds: [id] })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const before = await get(); expect(before.segmentIds).toHaveLength(1); expect(before.revision).toBe(2);
    expect((await request(`${base()}/1.4.1/segments`, "PUT", { revision: 2, segmentIds: ["SEGM-20261024-AAAAAAAAAA"] })).status).toBe(409);
    expect(await get()).toEqual(before);
    expect((await request(`${base()}/1.4.1/segments`, "PUT", { revision: 1, segmentIds: [] })).status).toBe(409); expect(await get()).toEqual(before);
    const deleted = await segment("将删除"); await request(`/api/admin/segments/${deleted.id}`, "DELETE", { revision: 1 });
    const repository = new VersionRepository(env.API_PLATFORM_DB, "buaa-classhopper");
    expect(await repository.setSegments("1.4.1", 2, [deleted.id], "2026-10-24T01:00:00Z")).toBe(false); expect(await get()).toEqual(before);
  });
  it("protects referenced segments and latest/gray versions until references are explicitly removed", async () => {
    await create(); const s = await segment(); await associate("1.4.1", [s.id]);
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 })).status).toBe(409);
    expect((await request(`${base()}/1.4.1`, "DELETE", { revision: 2 })).status).toBe(409);
    await associate("1.4.1", []); await promote("1.4.1"); await latest("1.4.1");
    expect((await request(`${base()}/1.4.1`, "DELETE", { revision: 4 })).status).toBe(409);
    await latest(null);
    expect((await request(`${base()}/1.4.1`, "DELETE", { revision: 4 })).status).toBe(200);
    expect((await request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 })).status).toBe(200);
  });
  it("serializes assignment against segment deletion without committing a dangling array ID", async () => {
    await create(); const s = await segment();
    const [assigned, removed] = await Promise.all([
      request(`${base()}/1.4.1/segments`, "PUT", { revision: 1, segmentIds: [s.id] }),
      request(`/api/admin/segments/${s.id}`, "DELETE", { revision: 1 }),
    ]);
    expect([assigned.status, removed.status].sort()).toEqual([200, 409]);
    const value = await get(), exists = await env.API_PLATFORM_DB.prepare("SELECT id FROM segments WHERE id=?").bind(s.id).first();
    expect(value.segmentIds).toEqual(exists ? [s.id] : []);
  });
  it("preserves optional authentication and fails on unreadable memberships without affecting anonymous latest", async () => {
    await create("1.4.1", undefined, { releaseType: "full" }); await latest("1.4.1"); await create("1.5.0");
    const s = await segment("x", { sso_id: ["user-1"] }); await associate("1.5.0", [s.id]);
    await env.API_PLATFORM_DB.prepare("UPDATE segments SET snapshot_key=? WHERE id=?").bind(`missing:${crypto.randomUUID()}`, s.id).run();
    expect((await request(pub(), "GET", undefined, { Authorization: "Bearer valid-buaa-classhopper" })).status).toBe(503);
    expect((await resolve()).version?.version).toBe("1.4.1");
    for (const token of ["invalid", "valid-second_app"]) expect((await request(pub(), "GET", undefined, { Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await request(pub(), "GET", undefined, { Authorization: "Bearer unavailable" })).status).toBe(503);
    expect((await request(`${pub()}?sso_id=user-1`)).status).toBe(400);
    expect((await request(`${base()}/rollouts`, "PUT", { versionCode: 1, version: "1.4.1", ssoIds: ["user-1"], revision: 1 })).status).not.toBe(200);
  });
});
