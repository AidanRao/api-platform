import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import migration from "../migrations/0004_reservations_and_api_tokens.sql?raw";
import { createApp } from "../src/app";
import { AccessDeniedError } from "../src/http/access-auth";
import { generateApiToken } from "../src/http/api-token";
import type { AppVersion, Settings } from "../src/features/versions/schema";
import { app, apps, clean, migrate, now, read, request, segment } from "./segment-fixture";

const path = "/api/token/buaa-classhopper/versions";
const admin = "/api/admin/buaa-classhopper/versions";
const tokens = "/api/admin/buaa-classhopper/api-tokens";
const issue = (permissions = ["versions:create"]) => request(tokens, "POST", { name: "发布流水线", permissions })
  .then(read<{ id: string; token: string; permissions: string[] }>);
const create = (body: unknown, token?: string) => request(path, "POST", body, token ? { Authorization: `Bearer ${token}` } : {});
const get = (version = "1.6.0") => request(`${admin}/${version}`).then(read<AppVersion>);

beforeAll(async () => {
  await env.API_PLATFORM_DB.batch(migration.split(";").filter((sql) => sql.trim()).map((sql) => env.API_PLATFORM_DB.prepare(sql)));
  await migrate();
});
beforeEach(async () => { await clean(); await env.API_PLATFORM_DB.prepare("DELETE FROM api_tokens").run(); });
afterEach(() => vi.restoreAllMocks());

describe("API Token version creation", () => {
  it("creates gray releases with version metadata and token audit without changing latest", async () => {
    await request(admin, "POST", { versionCode: 1, version: "1.4.1", releaseType: "full" }).then(read<AppVersion>);
    const settings = await request(`${admin}/latest`, "PUT", { revision: 1, version: "1.4.1" }).then(read<Settings>);
    const issued = await issue(), log = vi.spyOn(console, "log");
    const input = { versionCode: 1, version: "1.6.0", releaseNotes: "## 本次更新\n\n修复问题", packageInfo: { downloadUrl: "https://cdn.example.com/app.apk?signature=abc", downloadSizeBytes: 123456, sha256: "a".repeat(64) } };
    const response = await create(input, issued.token);
    expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("no-store");
    const version = await read<AppVersion>(response);
    expect(version).toMatchObject({ ...input, releaseType: "gray", segmentIds: [], revision: 1 });
    expect(await get()).toEqual(version);
    expect(await request(`${admin}/latest`).then(read<Settings>)).toEqual(settings);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ message: "versions changed", appId: "buaa-classhopper", action: "create", actorTokenId: issued.id }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(issued.token);
  });
  it("applies defaults and returns conflict without overwriting an existing version", async () => {
    const { token } = await issue();
    const created = await create({ versionCode: 1, version: "1.6.0" }, token).then(read<AppVersion>);
    expect(created).toMatchObject({ releaseType: "gray", segmentIds: [], releaseNotes: "", packageInfo: null, revision: 1 });
    const duplicate = await create({ versionCode: 1, version: "1.6.0", releaseNotes: "不能覆盖" }, token);
    expect(duplicate.status).toBe(409); expect(duplicate.headers.get("Cache-Control")).toBe("no-store");
    expect(await get()).toEqual(created);
    const full = await request(admin, "POST", { versionCode: 1, version: "1.7.0", releaseType: "full" }).then(read<AppVersion>);
    expect((await create({ versionCode: 1, version: full.version }, token)).status).toBe(409);
    expect(await get(full.version)).toEqual(full);
  });
  it("rejects releaseType and unknown fields rather than accepting caller-selected release types", async () => {
    const { token } = await issue();
    for (const extra of [{ releaseType: "full" }, { releaseType: "gray" }, { releaseType: null }, { releaseType: false }, { latestVersion: "1.6.0" }, { appId: "second_app" }, { revision: 1 }]) {
      const response = await create({ versionCode: 1, version: "1.6.0", ...extra }, token);
      expect(response.status).toBe(400); expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect((await request(`${admin}/1.6.0`)).status).toBe(404);
  });
  it("reuses version input validation and request-size limits", async () => {
    const { token } = await issue();
    for (const input of [{}, { versionCode: 1, version: "01.6.0" }, { versionCode: 1, version: "1.6.0-beta" }, { versionCode: 1, version: "1.6.0", downloadUrl: "javascript:alert(1)" }, { versionCode: 1, version: "1.6.0", downloadSizeBytes: 0 }, { versionCode: 1, version: "1.6.0", releaseNotes: "x".repeat(256 * 1024 + 1) }]) {
      expect((await create(input, token)).status).toBe(400);
    }
    const malformed = await app.request(`https://example.test${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{" }, env);
    expect(malformed.status).toBe(400);
    const oversized = await create({ versionCode: 1, version: "1.6.0", releaseNotes: "x".repeat(320 * 1024) }, token);
    expect(oversized.status).toBe(413); expect(oversized.headers.get("Cache-Control")).toBe("no-store");
    expect((await request(`${admin}/1.6.0`)).status).toBe(404);
  });
  it("requires an active app-scoped API Token with versions:create", async () => {
    for (const token of [undefined, "valid-buaa-classhopper", "invalid", generateApiToken()]) {
      const response = await create({ versionCode: 1, version: "1.6.0" }, token);
      expect(response.status).toBe(401); expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect((await create({ versionCode: 1, version: "1.6.0" }, (await issue(["reservations:read"])).token)).status).toBe(403);
    for (const change of ["revoked", "expired", "other-app"]) {
      const issued = await issue();
      if (change === "revoked") await request(`${tokens}/${issued.id}`, "DELETE");
      if (change === "expired") await env.API_PLATFORM_DB.prepare("UPDATE api_tokens SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(issued.id).run();
      if (change === "other-app") await env.API_PLATFORM_DB.prepare("UPDATE api_tokens SET app_id='second_app' WHERE id=?").bind(issued.id).run();
      expect((await create({ versionCode: 1, version: "1.6.0" }, issued.token)).status).toBe(401);
    }
    expect((await request(`${admin}/1.6.0`)).status).toBe(404);
  });
  it("uses API Token auth independently of administrator access and exposes only creation", async () => {
    const { token } = await issue();
    const verifyAccess = vi.fn(async () => { throw new AccessDeniedError("拒绝访问"); });
    const target = createApp(verifyAccess, now, apps);
    const response = await target.request(`https://example.test${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ versionCode: 1, version: "1.6.0" }) }, env);
    expect(response.status).toBe(201); expect(verifyAccess).not.toHaveBeenCalled();
    expect((await target.request(`https://example.test${admin}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ versionCode: 1, version: "1.7.0" }) }, env)).status).toBe(401);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const result = await request(path, method, undefined, { Authorization: `Bearer ${token}` });
      expect(result.status).toBe(405); expect(result.headers.get("Allow")).toBe("POST");
    }
    for (const suffix of ["/latest", "/1.6.0", "/1.6.0/segments"]) {
      expect((await request(`${path}${suffix}`, "PUT", { releaseType: "full" }, { Authorization: `Bearer ${token}` })).status).toBe(404);
    }
    expect((await request("/api/token/second_app/versions", "POST", { versionCode: 1, version: "1.6.0" }, { Authorization: `Bearer ${token}` })).status).toBe(404);
  });
  it("creates valid segment references atomically and rejects missing segments", async () => {
    const { token } = await issue(), s = await segment("内测", { sso_id: ["user-1"] });
    const created = await create({ versionCode: 1, version: "1.6.0", segmentIds: [s.id, s.id] }, token).then(read<AppVersion>);
    expect(created.segmentIds).toEqual([s.id]); expect(created.releaseType).toBe("gray");
    expect((await create({ versionCode: 1, version: "1.7.0", segmentIds: ["SEGM-20261025-AAAAAAAAAA"] }, token)).status).toBe(409);
    expect((await request(`${admin}/1.7.0`)).status).toBe(404);
  });
});
