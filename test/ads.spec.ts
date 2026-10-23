import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0005_ads.sql?raw";
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
const publish = (c: Creative) =>
  request(`${base}/creatives/${c.id}/publish`, "POST", {
    revision: c.revision,
  }).then(read<Creative>);
const slot = (appId = "buaa-classhopper", input = {}) =>
  request(`${scoped(appId)}/slots`, "POST", {
    slotKey: "home",
    name: "首页",
    format: "banner",
    enabled: true,
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
  await env.API_PLATFORM_DB.batch(
    migration
      .split(";")
      .filter((sql) => sql.trim())
      .map((sql) => env.API_PLATFORM_DB.prepare(sql)),
  );
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
  it("shares published snapshots across Apps without leaking draft edits, and retains history", async () => {
    const a = await campaign();
    let c = await publish(await creative());
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
      draft: { ...c.draft, title: "新草稿" },
    }).then(read<Creative>);
    expect((await delivery()).items[0]!.content.title).toBe("原始素材");
    c = await publish(c);
    for (const appId of apps.map((a) => a.id))
      expect((await delivery(appId)).items[0]).toMatchObject({
        publishedVersion: 2,
        content: { title: "新草稿" },
      });
    expect(await publish(c)).toEqual(c);
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
  it("publishes atomically under stale/concurrent revisions and rolls a failed batch back", async () => {
    const c = await creative();
    const results = await Promise.all([
      request(`${base}/creatives/${c.id}/publish`, "POST", { revision: 1 }),
      request(`${base}/creatives/${c.id}/publish`, "POST", { revision: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const repo = new AdsRepository(env.API_PLATFORM_DB);
    expect((await repo.versions(c.id, { page: 1, pageSize: 20 })).total).toBe(
      1,
    );
    expect(await repo.publishCreative(c.id, 1, now.toISOString())).toBeNull();
    await expect(
      env.API_PLATFORM_DB.batch([
        env.API_PLATFORM_DB.prepare(
          "INSERT INTO ad_creative_versions SELECT creative_id,2,content,published_at FROM ad_creative_versions WHERE creative_id=? AND version=1",
        ).bind(c.id),
        env.API_PLATFORM_DB.prepare(
          "INSERT INTO ad_creative_versions SELECT creative_id,2,content,published_at FROM ad_creative_versions WHERE creative_id=? AND version=1",
        ).bind(c.id),
      ]),
    ).rejects.toThrow();
    expect((await repo.versions(c.id, { page: 1, pageSize: 20 })).total).toBe(
      1,
    );
    expect((await repo.creative(c.id))!.publishedVersion).toBe(1);
    const saved = await request(`${base}/creatives/${c.id}`, "PATCH", {
      revision: 2,
      name: "新名称",
    }).then(read<Creative>);
    expect(
      (
        await request(`${base}/creatives/${c.id}/publish`, "POST", {
          revision: 2,
        })
      ).status,
    ).toBe(409);
    expect(saved.draft.imageUrl).toBe(image);
  });
  it("uses intersecting inclusive-start/exclusive-end schedules and stable priority ordering", async () => {
    const a = await campaign({
      startsAt: "2026-10-22T00:00:00Z",
      endsAt: "2026-10-23T00:00:00Z",
    });
    const c = await publish(await creative());
    const s = await slot("buaa-classhopper", {
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
    await request(`${scoped()}/slots/home`, "PATCH", {
      revision: s.revision,
      enabled: false,
    }).then(read);
    expect(await ids()).toEqual([]);
    await request(`${scoped()}/slots/home`, "PATCH", {
      revision: 2,
      enabled: true,
    }).then(read);
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
    expect(
      (await request(`${scoped()}/placements`, "POST", input)).status,
    ).toBe(400);
    const p = await placement(a, c, undefined, { enabled: false });
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
    await request(`${base}/creatives/${c.id}`, "DELETE", { revision: 1 }).then(
      read,
    );
  });
  it("requires Access, validates publishing and preserves omitted PATCH fields", async () => {
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
    const c = await creative({ type: "card", draft: {} });
    expect(
      (
        await request(`${base}/creatives/${c.id}/publish`, "POST", {
          revision: c.revision,
        })
      ).status,
    ).toBe(400);
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
    expect(
      (await request(`${base}/creatives/${c.id}/publish`, "GET")).status,
    ).toBe(405);
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
    const c = await publish(await creative());
    const slotPath = `${scoped(appId)}/slots/${slotKey}`;
    const created = await call(`${scoped(appId)}/slots`, "POST", {
      slotKey, name: "公告顶部", format: "banner", enabled: true,
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
    const c = await publish(await creative());
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
