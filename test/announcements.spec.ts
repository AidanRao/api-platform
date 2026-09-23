import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import migration from "../migrations/0001_announcements.sql?raw";
import { createApp } from "../src/app";
import { APPS, defineApps } from "../src/apps/registry";
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from "../src/features/announcements/routes";
import { AnnouncementRepository } from "../src/features/announcements/repository";
import type { Announcement } from "../src/features/announcements/schema";
import type { AppEnv } from "../src/http/types";

const admin = "/api/admin/buaa-classhopper/announcement";
const publicPath = "/api/buaa-classhopper/announcement";
const authenticated = async () => ({ email: "admin@example.com", subject: "admin" });
let now = new Date("2026-09-22T08:00:00.000Z");
const app = createApp(authenticated, () => now);
function request(path: string, method = "GET", body?: unknown) {
  return app.request(`https://example.com${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }, env);
}
async function data(response: Response) { return (await response.json() as { data: Announcement }).data; }
async function create(title = "公告", content = "# Hello\n\n**内容**\n", isPinned = false) {
  const result = await request(admin, "POST", { title, content, isPinned });
  expect(result.status).toBe(201);
  return data(result);
}
async function publish(item: Announcement) {
  const response = await request(`${admin}/${item.id}/publish`, "POST", { revision: item.revision });
  expect(response.status).toBe(200);
  return data(response);
}
beforeAll(async () => {
  await env.API_PLATFORM_DB.batch(migration.split(";").filter((sql) => sql.trim()).map((sql) => env.API_PLATFORM_DB.prepare(sql)));
});
beforeEach(async () => {
  await env.API_PLATFORM_DB.prepare("DELETE FROM announcements").run();
  now = new Date("2026-09-22T08:00:00.000Z");
});

describe("announcements API and D1", () => {
  it("returns an empty page publicly and does not depend on whitelist initialization", async () => {
    const response = await createApp().request(`https://example.com${publicPath}`, undefined, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: 1, msg: "获取成功", data: { items: [], page: 1, pageSize: 20, total: 0 } });
  });
  it("round trips raw Markdown; publishes, edits, unpublishes and republishes preserving first publication", async () => {
    let item = await create();
    expect(item.status).toBe("draft"); expect(item.publishedAt).toBeNull();
    expect(item.content).toBe("# Hello\n\n**内容**\n");
    expect((await (await request(publicPath)).json() as { data: { total: number } }).data.total).toBe(0);
    item = await publish(item);
    const first = item.publishedAt;
    now = new Date("2026-09-23T08:00:00.000Z");
    item = await data(await request(`${admin}/${item.id}`, "PATCH", { revision: item.revision, title: "编辑后", content: "新正文" }));
    expect(item.status).toBe("published"); expect(item.publishedAt).toBe(first);
    const visible = await (await request(publicPath)).json() as { data: { items: unknown[] } };
    expect(visible.data.items).toEqual([{ id: item.id, title: "编辑后", content: "新正文", publishedAt: first, isPinned: false }]);
    item = await data(await request(`${admin}/${item.id}/unpublish`, "POST", { revision: item.revision }));
    expect(item.status).toBe("unpublished");
    expect((await (await request(publicPath)).json() as { data: { total: number } }).data.total).toBe(0);
    item = await publish(item); expect(item.publishedAt).toBe(first);
    expect((await request(`${admin}/${item.id}`, "DELETE", { revision: item.revision })).status).toBe(200);
    expect((await request(`${admin}/${item.id}`)).status).toBe(404);
  });
  it("sorts pinned first then newest and supports stable pages and filtered totals", async () => {
    const oldPinned = await publish(await create("旧置顶", "正文", true));
    const old = await publish(await create("旧普通"));
    now = new Date("2026-09-23T08:00:00.000Z");
    const newer = await publish(await create("新普通"));
    await create("未发布");
    const getPage = async (page: number) => (await (await request(`${publicPath}?page=${page}&pageSize=1`)).json() as { data: { items: Announcement[]; total: number } }).data;
    expect((await getPage(1)).items[0]?.id).toBe(oldPinned.id);
    expect((await getPage(2)).items[0]?.id).toBe(newer.id);
    expect((await getPage(3)).items[0]?.id).toBe(old.id);
    expect(await getPage(4)).toMatchObject({ items: [], total: 3 });
    expect((await (await request(`${admin}?status=draft`)).json() as { data: { total: number } }).data.total).toBe(1);
    const tie = await publish(await create("同时间"));
    const all = (await (await request(publicPath)).json() as { data: { items: Announcement[] } }).data.items;
    expect(all.slice(1, 3).map((item) => item.id)).toEqual([newer.id, tie.id].sort().reverse());
  });
  it("conditionally updates one revision only and rejects stale writes, state changes and deletes", async () => {
    const item = await create();
    const results = await Promise.all(["A", "B"].map((title) => request(`${admin}/${item.id}`, "PATCH", { revision: item.revision, title })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    for (const [suffix, method] of [["", "PATCH"], ["/publish", "POST"], ["/unpublish", "POST"], ["", "DELETE"]]) {
      const result = await request(`${admin}/${item.id}${suffix}`, method, { revision: item.revision, ...(method === "PATCH" ? { title: "过期" } : {}) });
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ data: { currentRevision: 2 } });
    }
  });
  it("gives every registered application common capabilities but keeps BUAA extensions private", async () => {
    const apps = defineApps([...APPS, { id: "second-app", name: "Second App" }]);
    const platform = createApp(authenticated, () => now, apps);
    const invoke = (path: string, method = "GET", body?: unknown) => platform.request(`https://example.com${path}`, {
      method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }, env);
    const otherBase = "/api/admin/second-app/announcement";
    const created = await data(await invoke(otherBase, "POST", { title: "Second app announcement", content: "other app content" }));
    expect(created.status).toBe("draft");
    expect((await invoke(`${otherBase}/${created.id}/publish`, "POST", { revision: created.revision })).status).toBe(200);
    const otherPublic = await (await invoke("/api/second-app/announcement")).json() as { data: { items: Announcement[] } };
    expect(otherPublic.data.items[0]?.id).toBe(created.id);
    expect((await (await invoke(publicPath)).json() as { data: { total: number } }).data.total).toBe(0);
    expect((await invoke(`${admin}/${created.id}`)).status).toBe(404);
    expect((await invoke(`${admin}/${created.id}`, "DELETE", { revision: 2 })).status).toBe(404);
    expect((await invoke("/api/admin/media/images", "POST")).status).toBe(503);
    expect((await invoke("/api/second-app/v1/iclass/access-policy")).status).toBe(404);
    expect((await invoke("/api/admin/second-app/v1/iclass/access-policy", "PATCH", {})).status).toBe(404);
    expect((await invoke("/api/admin/not-registered/media/images", "POST")).status).toBe(404);
  });

  it("isolates shared routes and all mutations by application, including existing foreign IDs", async () => {
    const foreign = await new AnnouncementRepository(env.API_PLATFORM_DB, "other-app").create({ title: "其他应用", content: "secret", isPinned: false }, now.toISOString());
    for (const [suffix, method] of [["", "GET"], ["", "PATCH"], ["/publish", "POST"], ["/unpublish", "POST"], ["", "DELETE"]]) {
      expect((await request(`${admin}/${foreign.id}${suffix}`, method, method === "GET" ? undefined : { revision: 1, ...(method === "PATCH" ? { title: "越权" } : {}) })).status).toBe(404);
    }
    expect((await request("/api/other-app/announcement")).status).toBe(404);
    expect((await request("/api/admin/other-app/announcement")).status).toBe(404);
    // Reusing the same feature for a second registered application needs no forked implementation.
    const other = new Hono<AppEnv>();
    other.use("*", async (c, next) => { c.set("accessIdentity", await authenticated()); await next(); });
    other.route("/admin", createAdminAnnouncementRoutes("other-app", () => now));
    other.route("/public", createPublicAnnouncementRoutes("other-app"));
    expect((await other.request("https://example.com/admin", undefined, env)).status).toBe(200);
    const body = await (await request(admin)).json() as { data: { total: number } };
    expect(body.data.total).toBe(0);
  });
  it.each(["?page=0", "?page=1.5", "?pageSize=101", "?pageSize=-1", "?page=99999999999999999"])("rejects invalid pagination %s", async (query) => {
    expect((await request(publicPath + query)).status).toBe(400);
  });
  it("validates strict fields and UTF-8 byte limits", async () => {
    for (const input of [{ title: " " }, { title: "x".repeat(201) }, { title: "x", appId: "other" }, { title: "x", isPinned: "true" }, { title: "x", content: "中".repeat(90_000) }]) {
      expect((await request(admin, "POST", input)).status).toBe(400);
    }
    const large = await create("边界", "a".repeat(256 * 1024));
    expect(large.content.length).toBe(256 * 1024);
    const empty = await create("空正文", "  \n");
    expect((await request(`${admin}/${empty.id}/publish`, "POST", { revision: empty.revision })).status).toBe(400);
    expect((await request(`${admin}/${empty.id}/unpublish`, "POST", { revision: empty.revision })).status).toBe(400);
    const live = await publish(await create());
    expect((await request(`${admin}/${live.id}`, "PATCH", { revision: live.revision, content: " " })).status).toBe(400);
  });
  it("handles malformed JSON and method mismatches", async () => {
    expect((await app.request(`https://example.com${admin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }, env)).status).toBe(400);
    expect((await request(publicPath, "POST")).status).toBe(405);
    expect((await request("/api/admin/media/images")).status).toBe(405);
  });
  it("requires authentication on all management endpoints, including images", async () => {
    for (const [path, method] of [[admin, "GET"], [admin, "POST"], [`${admin}/id`, "PATCH"], [`${admin}/id`, "DELETE"], [`${admin}/id/publish`, "POST"], [`${admin}/id/unpublish`, "POST"], ["/api/admin/media/images", "POST"]]) {
      expect((await createApp().request(`https://example.com${path}`, { method }, env)).status).toBe(401);
    }
  });
  it("reports missing OSS separately without preventing text operations", async () => {
    expect((await request("/api/admin/media/images", "POST")).status).toBe(503);
    await create();
  });
});
