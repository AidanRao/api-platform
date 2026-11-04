import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdmin, ok, fail } from "../../test-utils";
import { metricsFixture } from "../../../../test/fixtures/metrics";
import { addDays, shanghaiDay } from "../../../../src/features/ads/metrics-schema";

const meta = { revision: 1, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
const placement = { ...meta, id: "placement-1", appId: "buaa-classhopper", campaignId: "campaign-1", creativeId: "creative-1", slotKey: "home", targetUrl: null, priority: 0, enabled: true, startsAt: null, endsAt: null };
let metricCalls: { url: URL; signal: AbortSignal | undefined }[];
let metricsFail = false;
let deferMetrics: ((value: Response) => void) | null = null;
let defer = false;
let current = { ...placement };
beforeEach(() => {
  metricCalls = []; metricsFail = false; deferMetrics = null; defer = false; current = { ...placement };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://test");
    if (url.pathname.endsWith("/metrics")) {
      metricCalls.push({ url, signal: init?.signal ?? undefined });
      if (defer) return new Promise<Response>((resolve) => { deferMetrics = resolve; });
      if (metricsFail) return fail(502, "广告统计暂不可用，请稍后重试");
      return ok(metricsFixture({ app_id: "11", ads_app_id: url.pathname.split("/")[3]!, placement_id: url.pathname.split("/")[6]!,
        from_day: url.searchParams.get("from_day")!, to_day: url.searchParams.get("to_day")! }));
    }
    if (/\/ads\/placements\/placement-\d+$/.test(url.pathname)) {
      if (init?.method === "PATCH") current = { ...current, ...JSON.parse(String(init.body)), revision: current.revision + 1 };
      return ok({ ...current, id: url.pathname.split("/").at(-1), appId: url.pathname.split("/")[3] });
    }
    if (url.pathname.endsWith("/campaigns/campaign-1")) return ok({ ...meta, id: "campaign-1", name: "活动", notes: "", enabled: true, startsAt: null, endsAt: null });
    if (url.pathname.endsWith("/creatives/creative-1")) return ok({ ...meta, id: "creative-1", name: "素材", type: "image", draft: { imageUrl: null, title: "素材", description: "", buttonText: "" }, publishedVersion: 1,
      published: { creativeId: "creative-1", version: 1, publishedAt: meta.createdAt, content: { imageUrl: null, title: "素材", description: "", buttonText: "" } } });
    if (url.pathname.endsWith("/slots/home")) return ok({ ...meta, appId: "buaa-classhopper", slotKey: "home", name: "首页", format: "banner", maxItems: 1 });
    return ok({ items: [], page: 1, pageSize: 20, total: 0 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const start = () => renderAdmin("/admin/buaa-classhopper/ads/placements/placement-1");
async function openStats() { await userEvent.click(await screen.findByRole("tab", { name: "投放数据" })); }

describe("on-demand placement statistics", () => {
  it("loads only on the first data-tab visit and ignores focus, reconnect and invalidations", async () => {
    const { client, router } = start();
    await screen.findByRole("button", { name: "保存投放" }); expect(metricCalls).toHaveLength(0);
    const path = router.state.location.pathname;
    await openStats(); await screen.findByRole("table", { name: "每日明细" });
    expect(metricCalls).toHaveLength(1); expect(metricCalls[0]!.url.searchParams.get("from_day")).toBe(addDays(shanghaiDay(), -6));
    expect(metricCalls[0]!.url.searchParams.get("to_day")).toBe(addDays(shanghaiDay(), 1));
    expect(screen.queryByRole("group", { name: "页面操作" })).toBeNull();
    expect(screen.getByRole("img", { name: "曝光趋势每日趋势" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "基本信息" })); await openStats();
    await act(async () => {
      window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
      await client.invalidateQueries({ queryKey: ["ads"] });
    });
    expect(metricCalls).toHaveLength(1); expect(router.state.location.pathname).toBe(path);
    expect(screen.getByText("7,000")).toBeTruthy();
  });

  it("stages presets and dates, queries explicitly, and refreshes the same range on demand", async () => {
    start(); await openStats(); await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    expect(metricCalls).toHaveLength(1);
    expect(screen.getByText(`统计范围：${addDays(shanghaiDay(), -6)} 至 ${shanghaiDay()}（上海时间）`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: addDays(shanghaiDay(), -2) } });
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(metricCalls).toHaveLength(2));
    await screen.findByRole("table"); expect(screen.getByText("3,000")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(metricCalls).toHaveLength(3));
  });

  it("retains drafts across tabs and does not refetch statistics after saving a placement", async () => {
    start(); fireEvent.change(await screen.findByLabelText("优先级"), { target: { value: "17" } });
    await openStats(); await screen.findByRole("table");
    await userEvent.click(screen.getByRole("tab", { name: "基本信息" }));
    expect((screen.getByLabelText("优先级") as HTMLInputElement).value).toBe("17");
    await userEvent.click(screen.getByRole("button", { name: "保存投放" }));
    await screen.findByText("已保存"); await openStats();
    expect(metricCalls).toHaveLength(1); expect(screen.getByRole("table")).toBeTruthy();
  });

  it("clears stale results on failed queries and retries only through an explicit action", async () => {
    start(); await openStats(); await screen.findByRole("table"); metricsFail = true;
    await userEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    await userEvent.click(screen.getByRole("button", { name: "查询" }));
    await screen.findByRole("alert"); expect(screen.queryByRole("table")).toBeNull();
    expect(metricCalls).toHaveLength(2);
    await userEvent.click(screen.getByRole("tab", { name: "基本信息" })); await openStats();
    expect(metricCalls).toHaveLength(2); metricsFail = false;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("table"); expect(metricCalls).toHaveLength(3); expect(screen.getByText("30,000")).toBeTruthy();
  });

  it("disables statistics for new placements", async () => {
    renderAdmin("/admin/buaa-classhopper/ads/placements/new");
    const tab = await screen.findByRole("tab", { name: "投放数据" });
    expect((tab as HTMLButtonElement).disabled).toBe(true); expect(tab.getAttribute("title")).toBe("请先保存投放");
    expect(metricCalls).toHaveLength(0);
  });

  it("cancels a pending request when navigating and never leaks old responses into the next placement", async () => {
    const { router } = start(); defer = true; await openStats();
    await waitFor(() => expect(metricCalls).toHaveLength(1));
    const signal = metricCalls[0]!.signal;
    await act(async () => { await router.navigate("/admin/buaa-classhopper/ads/placements/placement-2"); });
    expect(signal?.aborted).toBe(true); defer = false;
    await act(async () => { deferMetrics?.(fail(502, "旧投放错误")); });
    await openStats(); await screen.findByRole("table");
    expect(metricCalls).toHaveLength(2); expect(metricCalls[1]!.url.pathname).toContain("placement-2/metrics");
    expect(screen.queryByText("旧投放错误")).toBeNull();
  });
});
