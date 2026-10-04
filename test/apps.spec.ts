import { describe, expect, it } from "vitest";
import { APPS, appApiPath, appFromAdminPath, defineApps, findApp, isAdminPage } from "../src/apps/registry";

describe("code-maintained application registry", () => {
  it("resolves app identity and its path without depending on capabilities", () => {
    expect(findApp("buaa-classhopper")).toEqual({ id: "buaa-classhopper", name: "BUAA ClassHopper" });
    expect(appFromAdminPath("/admin/buaa-classhopper/")).toBe(APPS[0]);
    expect(appFromAdminPath("/admin/buaa-classhopper")).toBe(APPS[0]);
    expect(appApiPath("buaa-classhopper", true)).toBe("/api/admin/buaa-classhopper");
  });
  it.each(["/admin/unknown/", "/admin/", "/admin/index.html", "/admin/buaa-classhopper-other/", "/admin/%62uaa-classhopper/"])("rejects non-registered management paths %s", (path) => {
    expect(appFromAdminPath(path)).toBeUndefined();
  });
  it("rejects duplicates, empty names and reserved or unsafe slugs", () => {
    expect(() => defineApps([{ id: "test", name: "Test" }, { id: "test", name: "Again" }])).toThrow();
    for (const id of ["", "assets", "index", "admin", "apps", "media", "token", "../other", "some/app", "foo?bar", "foo_1"]) {
      expect(() => defineApps([{ id, name: "Test" }])).toThrow();
    }
    expect(() => defineApps([{ id: "test", name: " " }])).toThrow();
  });
});

import { env } from "cloudflare:workers";
import { createApp } from "../src/app";
describe("platform administration", () => {
  it("exposes registered application metadata in order behind Access", async () => {
    const apps = defineApps([{ id: "b", name: "Second" }, { id: "a", name: "First" }]);
    const app = createApp(async () => ({ email: "admin@example.com", subject: "admin" }), undefined, apps);
    const response = await app.request("https://example.com/api/admin/apps", undefined, env);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: 1, msg: "获取成功", data: { items: apps } });
    expect((await createApp().request("https://example.com/api/admin/apps", undefined, env)).status).toBe(401);
    expect((await app.request("https://example.com/api/admin/apps", { method: "POST" }, env)).status).toBe(405);
    expect((await app.request("https://example.com/api/admin/media/images", { method: "POST" }, env)).status).toBe(503);
    expect((await app.request("https://example.com/api/admin/b/media/images", { method: "POST" }, env)).status).toBe(404);
  });
  it("matches only registered pages and their resource detail routes", () => {
    for (const path of ["/admin/", "/admin/buaa-classhopper/", "/admin/buaa-classhopper/whitelist", "/admin/buaa-classhopper/reservations", "/admin/buaa-classhopper/api-tokens", "/admin/buaa-classhopper/api-tokens/new", "/admin/buaa-classhopper/announcements", "/admin/buaa-classhopper/announcements/new", "/admin/buaa-classhopper/announcements/abc"]) expect(isAdminPage(path)).toBe(true);
    expect(isAdminPage("/admin/second-app/api-tokens", defineApps([{ id: "second-app", name: "Second" }]))).toBe(true);
    for (const path of ["/admin/unknown/announcements", "/admin/buaa-classhopper/extra", "/admin/buaa-classhopper/announcements/abc/extra"]) expect(isAdminPage(path)).toBe(false);
  });
});
