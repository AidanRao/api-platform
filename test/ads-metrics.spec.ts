import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import migration from "../migrations/0005_ads.sql?raw";
import slotMigration from "../migrations/0006_ads_slots_always_enabled.sql?raw";
import { createApp } from "../src/app";
import { defineApps } from "../src/apps/registry";
import { AccessDeniedError } from "../src/http/access-auth";
import { queryPlacementMetrics } from "../src/features/ads/metrics";
import { type PlacementMetricsQuery } from "../src/features/ads/metrics-schema";
import { metricsFixture } from "./fixtures/metrics";

const now = new Date("2026-11-04T04:00:00Z");
const apps = defineApps([{ id: "buaa-classhopper", name: "BUAA" }, { id: "second-app", name: "Second" }]);
const app = createApp(async () => ({ subject: "admin", email: null }), () => now, apps);
const base = "/api/admin/buaa-classhopper/ads/placements/placement-1/metrics";
const range = { from_day: "2026-11-01", to_day: "2026-11-05" };
const rpc = vi.fn(async (query: PlacementMetricsQuery): Promise<unknown> => ({ code: "OK", success: true, message: "Success", result: metricsFixture(query) }));
const binding = { fetch: async () => new Response(null, { status: 404 }), connect() { throw new Error("TCP unavailable in this mock"); }, queryPlacementMetrics: rpc };
const bindings = () => ({ ...env, EVENT_ANALYTICS: binding, EVENT_ANALYTICS_APP_IDS: { "buaa-classhopper": "11" as const } });
const request = (query = new URLSearchParams(range).toString(), overrides = {}, path = base, method = "GET") =>
  app.request(`https://test${path}?${query}`, { method }, { ...bindings(), ...overrides });

beforeAll(async () => {
  for (const sql of [migration, slotMigration]) await env.API_PLATFORM_DB.batch(sql.split(";").filter((s) => s.trim()).map((s) => env.API_PLATFORM_DB.prepare(s)));
  const t = now.toISOString();
  await env.API_PLATFORM_DB.batch([
    env.API_PLATFORM_DB.prepare("INSERT INTO ad_campaigns(id,name,created_at,updated_at) VALUES('campaign-1','Campaign',?,?)").bind(t, t),
    env.API_PLATFORM_DB.prepare("INSERT INTO ad_creatives(id,name,type,draft,created_at,updated_at) VALUES('creative-1','Creative','image','{}',?,?)").bind(t, t),
    ...apps.map((a) => env.API_PLATFORM_DB.prepare("INSERT INTO ad_slots(app_id,slot_key,name,format,max_items,created_at,updated_at) VALUES(?,'home','Home','banner',1,?,?)").bind(a.id, t, t)),
    env.API_PLATFORM_DB.prepare("INSERT INTO ad_placements(id,campaign_id,app_id,slot_key,creative_id,created_at,updated_at) VALUES('placement-1','campaign-1','buaa-classhopper','home','creative-1',?,?)").bind(t, t),
  ]);
});
beforeEach(() => {
  rpc.mockReset(); rpc.mockImplementation(async (query) => ({ code: "OK", success: true, message: "Success", result: metricsFixture(query) }));
});

describe("on-demand advertising metrics", () => {
  it("maps server identity, returns the existing envelope and does not persist or cache copies", async () => {
    for (let i = 0; i < 2; i++) {
      const response = await request(); expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ code: 1, data: { ads_app_id: "buaa-classhopper", placement_id: "placement-1", summary: { impressions: 4000 } } });
    }
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith({ ...range, app_id: "11", ads_app_id: "buaa-classhopper", placement_id: "placement-1" });
    expect((await env.API_PLATFORM_DB.prepare("SELECT revision FROM ad_placements WHERE id='placement-1'").first<{ revision: number }>())?.revision).toBe(1);
  });

  it("requires Access and an existing placement in the current App before invoking RPC", async () => {
    const denied = createApp(async () => { throw new AccessDeniedError("未登录"); }, () => now, apps);
    expect((await denied.request(`https://test${base}?${new URLSearchParams(range)}`, {}, bindings())).status).toBe(401);
    expect((await request(undefined, {}, base.replace("placement-1", "unknown"))).status).toBe(404);
    expect((await request(undefined, {}, base.replace("buaa-classhopper", "second-app"))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks exact date ranges and rejects caller identity overrides", async () => {
    for (const query of ["", "from_day=2026-02-30&to_day=2026-11-05", "from_day=2026-08-06&to_day=2026-11-05",
      "from_day=2026-11-05&to_day=2026-11-05", "from_day=2026-11-04&to_day=2026-11-06",
      `${new URLSearchParams(range)}&app_id=other`, `${new URLSearchParams(range)}&placement_id=other`])
      expect((await request(query)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await request("from_day=2026-08-07&to_day=2026-11-05")).status).toBe(200);
  });

  it("reports missing binding/mapping and unregistered upstream App as unavailable", async () => {
    for (const overrides of [{ EVENT_ANALYTICS: undefined }, { EVENT_ANALYTICS_APP_IDS: {} }, { EVENT_ANALYTICS_APP_IDS: "invalid" }])
      expect((await request(undefined, overrides)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ code: "A01-002", success: false, message: "internal configuration", result: {} });
    expect((await request()).status).toBe(503);
  });

  it("rejects invalid and mismatching upstream results without leaking upstream errors", async () => {
    rpc.mockRejectedValueOnce(new Error("upstream secret"));
    let response = await request(); expect(response.status).toBe(502); expect(await response.text()).not.toContain("upstream secret");
    for (const result of [{}, { code: "B00-001", success: false, message: "internal secret", result: {} },
      { code: "OK", success: true, message: "Success", result: metricsFixture({ ...range, app_id: "other", ads_app_id: "buaa-classhopper", placement_id: "placement-1" }) },
      { code: "OK", success: true, message: "Success", result: { ...metricsFixture({ ...range, app_id: "11", ads_app_id: "buaa-classhopper", placement_id: "placement-1" }), daily: [] } }]) {
      rpc.mockResolvedValueOnce(result); response = await request(); expect(response.status).toBe(502);
    }
    rpc.mockResolvedValueOnce({ code: "A03-007", success: false, message: "range", result: {} });
    expect((await request()).status).toBe(400);
  });

  it("bounds RPC waiting to ten seconds without retries", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => {}));
      const result = expect(queryPlacementMetrics(bindings(), "buaa-classhopper", "placement-1", range)).rejects.toMatchObject({ status: 502 });
      await vi.advanceTimersByTimeAsync(10_000); await result;
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("returns GET-only 405 responses without fetching statistics", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const response = await request(undefined, {}, base, method);
      expect(response.status).toBe(405); expect(response.headers.get("Allow")).toBe("GET");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
