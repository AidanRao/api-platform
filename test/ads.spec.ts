import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0005_ads.sql?raw";
import slotMigration from "../migrations/0006_ads_slots_always_enabled.sql?raw";
import { createApp } from "../src/app";
import { defineApps } from "../src/apps/registry";
import { AdsRepository } from "../src/features/ads/repository";
import {
  campaignPatchSchema,
  targetUrlSchema,
  type Campaign,
  type Creative,
  type AdSlot,
  type Placement,
} from "../src/features/ads/schema";
const apps = defineApps([
  { id: "buaa-classhopper", name: "BUAA" },
  { id: "second-app", name: "Second" },
]);
let now = new Date("2026-10-22T00:00:00.000Z");
const app = createApp(
  async () => ({ subject: "admin", email: "admin@test.com" }),
  () => now,
  apps,
);
const testEnv = {
  ...env,
  OSS_BUCKET: "test",
  OSS_REGION: "cn-hangzhou",
  OSS_PREFIX: "api-platform",
};
const image =
  "https://test.oss-cn-hangzhou.aliyuncs.com/api-platform/images/00000000-0000-4000-8000-000000000001.png";
const base = "/api/admin/ads";
const scoped = (appId = "buaa-classhopper") => `/api/admin/${appId}/ads`;
const publicUrl = (appId = "buaa-classhopper", key = "home") =>
  `/api/${appId}/ads/slots/${key}`;
const request = async (path: string, method = "GET", body?: unknown) =>
  app.request(
    `https://example.com${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
    testEnv,
  );
async function read<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data: T; msg: string };
  expect(response.status, body.msg).toBeLessThan(300);
  return body.data;
}
const campaign = (input = {}) =>
  request(`${base}/campaigns`, "POST", {
    name: "活动",
    enabled: true,
    ...input,
  }).then(read<Campaign>);
const creative = (input = {}) =>
  request(`${base}/creatives`, "POST", {
    name: "素材",
    type: "image",
    draft: { imageUrl: image, title: "原始素材" },
    ...input,
  }).then(read<Creative>);
const slot = (appId = "buaa-classhopper", input = {}) =>
  request(`${scoped(appId)}/slots`, "POST", {
    slotKey: "home",
    name: "首页",
    format: "banner",
    ...input,
  }).then(read<AdSlot>);
const placement = (
  a: Campaign,
  c: Creative,
  appId = "buaa-classhopper",
  input = {},
) =>
  request(`${scoped(appId)}/placements`, "POST", {
    campaignId: a.id,
    creativeId: c.id,
    slotKey: "home",
    enabled: true,
    targetUrl: "buaa-classhopper://annoucement/ANNC-1",
    ...input,
  }).then(read<Placement>);
const delivery = (appId = "buaa-classhopper") =>
  request(publicUrl(appId)).then(
    read<{
      items: {
        creativeId: string;
        publishedVersion: number;
        content: { title: string };
        targetUrl: string | null;
      }[];
    }>,
  );
beforeAll(async () => {
  const apply = (sql: string) => env.API_PLATFORM_DB.batch(
    sql.split(";").filter((statement) => statement.trim())
      .map((statement) => env.API_PLATFORM_DB.prepare(statement)),
  );
  await apply(migration);
  // Existing disabled slots retain their configuration when the column is removed.
  await env.API_PLATFORM_DB.prepare(
    "INSERT INTO ad_slots(app_id,slot_key,name,format,enabled,max_items,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?)",
  ).bind("buaa-classhopper", "legacy", "旧广告位", "carousel", 3, now.toISOString(), now.toISOString()).run();
  await apply(slotMigration);
  const migrated = await new AdsRepository(env.API_PLATFORM_DB).slot("buaa-classhopper", "legacy");
  expect(migrated).toMatchObject({ slotKey: "legacy", name: "旧广告位", format: "carousel", maxItems: 3, revision: 1 });
  expect(migrated).not.toHaveProperty("enabled");
});
beforeEach(async () => {
  await env.API_PLATFORM_DB.batch(
    [
      "ad_placements",
      "ad_slots",
      "ad_creative_versions",
      "ad_creatives",
      "ad_campaigns",
    ].map((table) => env.API_PLATFORM_DB.prepare(`DELETE FROM ${table}`)),
  );
  now = new Date("2026-10-22T00:00:00.000Z");
});
describe("shared ads", () => {
  it("publishes on create and save across Apps, and retains immutable history", async () => {
    const a = await campaign();
    let c = await creative();
    for (const appId of apps.map((a) => a.id)) {
      await slot(appId);
      await placement(a, c, appId);
    }
    expect((await delivery()).items[0]).toMatchObject({
      publishedVersion: 1,
      targetUrl: "buaa-classhopper://annoucement/ANNC-1",
      content: { title: "原始素材" },
    });
    c = await request(`${base}/creatives/${c.id}`, "PATCH", {
      revision: c.revision,
      draft: { ...c.draft, title: "新内容" },
    }).then(read<Creative>);
    for (const appId of apps.map((a) => a.id))
      expect((await delivery(appId)).items[0]).toMatchObject({
        publishedVersion: 2,
        content: { title: "新内容" },
      });
    const renamed = await request(`${base}/creatives/${c.id}`, "PATCH", {
      revision: c.revision, name: "仅改名称",
    }).then(read<Creative>);
    expect(renamed.publishedVersion).toBe(2);
    expect(renamed.revision).toBe(c.revision + 1);
    const old = await request(`${base}/creatives/${c.id}/versions/1`).then(
      read<{ content: { title: string } }>,
    );
    expect(old.content.title).toBe("原始素材");
    const history = await request(`${base}/creatives/${c.id}/versions`).then(
      read<{ total: number }>,
    );
    expect(history.total).toBe(2);
    expect(JSON.stringify(await delivery())).not.toMatch(
      /draft|revision|notes|publishedAt/,
    );
    expect((await request(publicUrl())).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
  it("publishes a legacy unpublished creative on its next save", async () => {
    const content = { imageUrl: image, title: "旧素材", description: "", buttonText: "" };
    await env.API_PLATFORM_DB.prepare(
      "INSERT INTO ad_creatives(id,name,type,draft,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind("legacy-creative", "旧素材", "image", JSON.stringify(content), now.toISOString(), now.toISOString()).run();
    const saved = await request(`${base}/creatives/legacy-creative`, "PATCH", {
      revision: 1, name: "旧素材",
    }).then(read<Creative>);
    expect(saved).toMatchObject({ revision: 2, publishedVersion: 1, draft: content, published: { content } });
  });
  it("saves and publishes atomically under stale/concurrent revisions", async () => {
    const c = await creative();
    const results = await Promise.all([
      request(`${base}/creatives/${c.id}`, "PATCH", {
        revision: 1, draft: { ...c.draft, title: "并发 A" },
      }),
      request(`${base}/creatives/${c.id}`, "PATCH", {
        revision: 1, draft: { ...c.draft, title: "并发 B" },
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const repo = new AdsRepository(env.API_PLATFORM_DB);
    const saved = (await repo.creative(c.id))!;
    expect(saved.revision).toBe(2);
    expect(saved.publishedVersion).toBe(2);
    expect(saved.published!.content).toEqual(saved.draft);
    expect((await repo.versions(c.id, { page: 1, pageSize: 20 })).total).toBe(2);
    expect(await repo.updateCreative({ ...c, draft: { ...c.draft, title: "过期保存" } }, now.toISOString())).toBeNull();
    expect((await repo.versions(c.id, { page: 1, pageSize: 20 })).total).toBe(2);
  });
  it("rolls content, revision and snapshot back when saving fails", async () => {
    const repo = new AdsRepository(env.API_PLATFORM_DB);
    const c = await creative();
    await env.API_PLATFORM_DB.prepare(`CREATE TRIGGER fail_creative_update BEFORE UPDATE ON ad_creatives
      BEGIN SELECT RAISE(ABORT, 'forced save failure'); END`).run();
    try {
      await expect(repo.updateCreative({ ...c, name: "失败名称", draft: { ...c.draft, title: "失败内容" } }, now.toISOString())).rejects.toThrow();
      expect(await repo.creative(c.id)).toEqual(c);
      expect((await repo.versions(c.id, { page: 1, pageSize: 20 })).total).toBe(1);
    } finally {
      await env.API_PLATFORM_DB.prepare("DROP TRIGGER fail_creative_update").run();
    }
    await env.API_PLATFORM_DB.prepare(`CREATE TRIGGER fail_creative_version BEFORE INSERT ON ad_creative_versions
      BEGIN SELECT RAISE(ABORT, 'forced create failure'); END`).run();
    try {
      await expect(repo.createCreative({ name: "失败创建", type: "image", draft: c.draft }, now.toISOString())).rejects.toThrow();
      expect((await repo.creatives({ page: 1, pageSize: 20 })).total).toBe(1);
    } finally {
      await env.API_PLATFORM_DB.prepare("DROP TRIGGER fail_creative_version").run();
    }
  });
  it("uses intersecting inclusive-start/exclusive-end schedules and stable priority ordering", async () => {
    const a = await campaign({
      startsAt: "2026-10-22T00:00:00Z",
      endsAt: "2026-10-23T00:00:00Z",
    });
    const c = await creative();
    await slot("buaa-classhopper", {
      format: "carousel",
      maxItems: 2,
    });
    const first = await placement(a, c, undefined, {
      priority: 1,
      targetUrl: null,
    });
    now = new Date("2026-10-22T00:00:01Z");
    const second = await placement(a, c, undefined, { priority: 1 });
    const high = await placement(a, c, undefined, {
      priority: 9,
      startsAt: "2026-10-22T01:00:00Z",
      endsAt: "2026-10-22T02:00:00Z",
    });
    const ids = async () =>
      (
        await request(publicUrl()).then(
          read<{ items: { placementId: string }[] }>,
        )
      ).items.map((i) => i.placementId);
    expect(await ids()).toEqual([first.id, second.id]);
    now = new Date("2026-10-22T01:00:00Z");
    expect(await ids()).toEqual([high.id, first.id]);
    now = new Date("2026-10-22T02:00:00Z");
    expect(await ids()).toEqual([first.id, second.id]);
    now = new Date("2026-10-23T00:00:00Z");
    expect(await ids()).toEqual([]);
    expect(
      (
        await request(`${base}/campaigns/${a.id}`, "PATCH", {
          revision: a.revision,
          startsAt: "2026-10-24T00:00:00Z",
        })
      ).status,
    ).toBe(400);
  });
  it("protects references, immutable fields and App isolation", async () => {
    const a = await campaign();
    const c = await creative();
    await slot();
    const input = {
      campaignId: a.id,
      creativeId: c.id,
      slotKey: "home",
      enabled: true,
    };
    const p = await request(`${scoped()}/placements`, "POST", input).then(read<Placement>);
    expect(
      (
        await request(`${base}/creatives/${c.id}`, "DELETE", {
          revision: c.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`${base}/campaigns/${a.id}`, "DELETE", {
          revision: a.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request(`${scoped()}/slots/home`, "DELETE", { revision: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`${scoped("second-app")}/placements/${p.id}`)).status,
    ).toBe(404);
    expect(
      (
        await request(`${scoped("second-app")}/placements/${p.id}`, "PATCH", {
          revision: 1,
          enabled: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`${base}/creatives/${c.id}`, "PATCH", {
          revision: 1,
          type: "card",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`${scoped()}/slots/home`, "PATCH", {
          revision: 1,
          format: "card",
        })
      ).status,
    ).toBe(400);
    await slot("second-app", { format: "card" });
    expect(
      (
        await request(`${scoped("second-app")}/placements`, "POST", {
          ...input,
          enabled: false,
        })
      ).status,
    ).toBe(400);
    expect((await request(publicUrl("unknown"))).status).toBe(404);
    expect((await request(publicUrl(undefined, "missing"))).status).toBe(404);
    await request(`${scoped()}/placements/${p.id}`, "DELETE", {
      revision: 1,
    }).then(read);
    expect((await request(`${base}/creatives/${c.id}`, "DELETE", { revision: 2 })).status).toBe(409);
    await request(`${base}/creatives/${c.id}`, "DELETE", { revision: 1 }).then(read);
    expect((await request(`${base}/creatives/${c.id}`)).status).toBe(404);
    expect((await new AdsRepository(env.API_PLATFORM_DB).versions(c.id, { page: 1, pageSize: 20 })).total).toBe(0);
  });
  it("requires Access, validates saves and preserves omitted PATCH fields", async () => {
    expect(campaignPatchSchema.parse({ revision: 1, name: "new" })).toEqual({
      revision: 1,
      name: "new",
    });
    const unauth = createApp();
    expect(
      (
        await unauth.request(
          `https://example.com${base}/creatives`,
          undefined,
          testEnv,
        )
      ).status,
    ).toBe(401);
    for (const input of [
      { type: "image", draft: {} },
      { type: "card", draft: { imageUrl: image } },
    ]) {
      expect((await request(`${base}/creatives`, "POST", { name: "无效素材", ...input })).status).toBe(400);
    }
    const c = await creative({ type: "card" });
    expect((await request(`${base}/creatives/${c.id}`, "PATCH", {
      revision: c.revision, draft: { imageUrl: image },
    })).status).toBe(400);
    expect(await request(`${base}/creatives/${c.id}`).then(read<Creative>)).toEqual(c);
    expect(
      (
        await request(`${base}/creatives`, "POST", {
          name: "bad",
          type: "image",
          draft: { imageUrl: "https://external.com/a.png" },
        })
      ).status,
    ).toBe(400);
    const a = await campaign();
    const updated = await request(`${base}/campaigns/${a.id}`, "PATCH", {
      revision: a.revision,
      name: "renamed",
    }).then(read<Campaign>);
    expect(updated.enabled).toBe(true);
    expect(
      (
        await request(`${base}/campaigns/${a.id}`, "PATCH", {
          revision: a.revision,
          name: "stale",
        })
      ).status,
    ).toBe(409);

  });
});
describe("ads API boundaries", () => {
  it("supports underscored App and slot keys through management and public delivery", async () => {
    const appId = "snake_app";
    const slotKey = "announcement_top-banner";
    const instance = createApp(
      async () => ({ subject: "admin", email: "admin@test.com" }),
      () => now,
      defineApps([{ id: appId, name: "Snake" }]),
    );
    const call = async (path: string, method = "GET", body?: unknown) => instance.request(
      `https://example.com${path}`,
      { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) },
      testEnv,
    );
    const a = await campaign();
    const c = await creative();
    const slotPath = `${scoped(appId)}/slots/${slotKey}`;
    const created = await call(`${scoped(appId)}/slots`, "POST", {
      slotKey, name: "公告顶部", format: "banner",
    }).then(read<AdSlot>);
    expect(created.slotKey).toBe(slotKey);
    expect((await call(slotPath).then(read<AdSlot>)).slotKey).toBe(slotKey);
    await call(slotPath, "PATCH", { name: "公告广告", revision: 1 }).then(read);
    const p = await call(`${scoped(appId)}/placements`, "POST", {
      campaignId: a.id, creativeId: c.id, slotKey, enabled: true,
    }).then(read<Placement>);
    await call(`${scoped(appId)}/placements/${p.id}`, "PATCH", { slotKey, revision: 1 }).then(read);
    const listed = await call(`${scoped(appId)}/placements?slotKey=${slotKey}`).then(read<{ total: number; items: Placement[] }>);
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.slotKey).toBe(slotKey);
    const delivered = await call(publicUrl(appId, slotKey)).then(read<{ slotKey: string; items: { placementId: string }[] }>);
    expect(delivered.slotKey).toBe(slotKey);
    expect(delivered.items[0]?.placementId).toBe(p.id);
    await call(`${scoped(appId)}/placements/${p.id}`, "DELETE", { revision: 2 }).then(read);
    await call(slotPath, "DELETE", { revision: 2 }).then(read);
    expect((await call(publicUrl(appId, slotKey))).status).toBe(404);
  });
  it("treats slots as always available and rejects removed enabled fields", async () => {
    const a = await campaign();
    const c = await creative();
    const s = await slot();
    expect(s).not.toHaveProperty("enabled");
    expect(c).not.toHaveProperty("enabled");
    expect((await env.API_PLATFORM_DB.prepare("PRAGMA table_info(ad_slots)").all<{ name: string }>()).results.map((r) => r.name)).not.toContain("enabled");
    await placement(a, c);
    expect((await delivery()).items).toHaveLength(1);
    const list = await request(`${scoped()}/slots?enabled=false`).then(read<{ items: AdSlot[] }>);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("enabled");
    for (const [path, method, body] of [
      [`${scoped()}/slots`, "POST", { slotKey: "other", name: "广告位", format: "banner", enabled: false }],
      [`${scoped()}/slots/home`, "PATCH", { revision: 1, enabled: false }],
      [`${base}/creatives/${c.id}`, "PATCH", { revision: 1, enabled: false }],
    ] as const) {
      expect((await request(path, method, body)).status).toBe(400);
    }
  });
  it("continues rejecting reserved slot keys and URL path separators", async () => {
    for (const slotKey of ["new", "bad/key", "bad key", "../slot"]) {
      expect((await request(`${scoped()}/slots`, "POST", {
        slotKey, name: "无效广告位", format: "banner",
      })).status).toBe(400);
    }
  });
  it("rejects malformed bodies and invalid slot sizes, and allows paused delivery to resume", async () => {
    const malformed = await app.request(
      `https://example.com${base}/campaigns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      testEnv,
    );
    expect(malformed.status).toBe(400);
    expect(
      (
        await request(`${scoped()}/slots`, "POST", {
          slotKey: "bad",
          name: "bad",
          format: "banner",
          maxItems: 2,
        })
      ).status,
    ).toBe(400);
    const a = await campaign();
    const c = await creative();
    await slot();
    const p = await placement(a, c);
    expect(
      (
        await request(`${base}/creatives/${c.id}`, "DELETE", {
          revision: c.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request(`${base}/creatives/${c.id}/versions/99`)).status,
    ).toBe(404);
    expect(
      (
        await request(`${scoped()}/slots`, "POST", {
          slotKey: "home",
          name: "duplicate",
          format: "splash",
        })
      ).status,
    ).toBe(409);
    await request(`${base}/campaigns/${a.id}`, "PATCH", {
      revision: 1,
      enabled: false,
    }).then(read);
    expect((await delivery()).items).toEqual([]);
    await request(`${base}/campaigns/${a.id}`, "PATCH", {
      revision: 2,
      enabled: true,
    }).then(read);
    expect((await delivery()).items).toHaveLength(1);
    await request(`${scoped()}/placements/${p.id}`, "PATCH", {
      revision: 1,
      enabled: false,
    }).then(read);
    expect((await delivery()).items).toEqual([]);
    const refs = await request(
      `${base}/campaigns/${a.id}/placements?enabled=false`,
    ).then(read<{ total: number }>);
    expect(refs.total).toBe(1);
  });
});
describe("click URLs", () => {
  it.each([
    "http://example.com/a",
    "https://example.com/a?q=1#x",
    "buaa-classhopper://annoucement/ANNC-1",
    null,
  ])("accepts and preserves %s", (url) =>
    expect(targetUrlSchema.parse(url)).toBe(url),
  );
  it.each([
    "/relative",
    "//example.com",
    "https://a:b@example.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/plain,a",
    "file:///tmp/a",
    "blob:https://a/b",
    "vbscript:x",
    "https://exa\nmple.com",
    " https://example.com",
    "https://example.com/\u0085",
  ])("rejects %s", (url) =>
    expect(targetUrlSchema.safeParse(url).success).toBe(false),
  );
});
