import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdmin, ok, fail, apps } from "../../test-utils";
import type {
  Campaign,
  Creative,
  Placement,
  AdSlot,
} from "../../../../src/features/ads/schema";
const meta = {
  revision: 1,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
const image =
  "https://example.oss-cn-hangzhou.aliyuncs.com/api-platform/images/00000000-0000-4000-8000-000000000001.png";
let creative: Creative;
let campaign: Campaign;
let placement: Placement;
let slot: AdSlot;
let secondCreative: Creative | null = null;
let creativeListFails = false;
const extraCreative = (): Creative | null => secondCreative;
let conflict = false,
  uploadFails = false,
  placementDeleted = false;
  secondCreative = null;
  creativeListFails = false;
let writes: { url: string; body: Record<string, unknown> }[];
const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
});
beforeEach(() => {
  creative = {
    ...meta,
    id: "ADCR-1",
    name: "共享图片",
    type: "image",
    draft: { imageUrl: image, title: "原稿", description: "", buttonText: "" },
    publishedVersion: 1,
    published: {
      creativeId: "ADCR-1",
      version: 1,
      content: {
        imageUrl: image,
        title: "原稿",
        description: "",
        buttonText: "",
      },
      publishedAt: meta.createdAt,
    },
  };
  campaign = {
    ...meta,
    id: "ADCA-1",
    name: "推广活动",
    notes: "",
    enabled: false,
    startsAt: null,
    endsAt: null,
  };
  slot = {
    ...meta,
    appId: "buaa-classhopper",
    slotKey: "home",
    name: "首页",
    format: "banner",
    enabled: true,
    maxItems: 1,
  };
  placement = {
    ...meta,
    id: "ADPL-1",
    appId: "buaa-classhopper",
    campaignId: campaign.id,
    creativeId: creative.id,
    slotKey: "home",
    targetUrl: null,
    priority: 0,
    enabled: false,
    startsAt: null,
    endsAt: null,
  };
  writes = [];
  conflict = false;
  uploadFails = false;
  placementDeleted = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const otherCreative = extraCreative();
      const url = new URL(String(input), "https://local.test"),
        path = url.pathname;
      if (path === "/api/admin/apps") return ok({ items: apps });
      if (path === "/api/admin/media/images")
        return uploadFails ? fail(502, "图片上传失败") : ok({ url: image });
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      if (init?.method && init.method !== "GET")
        writes.push({ url: path, body });
      if (path === "/api/admin/ads/creatives/ADCR-1/publish") {
        creative = {
          ...creative,
          revision: creative.revision + 1,
          publishedVersion: 2,
          published: {
            creativeId: creative.id,
            version: 2,
            content: { ...creative.draft },
            publishedAt: meta.createdAt,
          },
        };
        return ok(creative);
      }
      if (path === "/api/admin/ads/creatives/ADCR-1/versions")
        return ok(page(creative.published ? [creative.published] : []));
      if (
        path.endsWith("/ADCR-1/placements") ||
        path.endsWith("/ADCA-1/placements")
      )
        return ok(page([placement]));
      if (path === "/api/admin/ads/creatives/ADCR-1") {
        if (init?.method === "PATCH")
          creative = { ...creative, ...body, revision: creative.revision + 1 };
        return ok(creative);
      }
      if (otherCreative && path === `/api/admin/ads/creatives/${otherCreative.id}`)
        return ok(otherCreative);
      if (path === "/api/admin/ads/campaigns/ADCA-2")
        return ok({ ...campaign, id: "ADCA-2", name: "第二活动" });
      if (path === "/api/admin/ads/campaigns/ADCA-1") {
        if (init?.method === "PATCH") {
          if (conflict) {
            campaign = { ...campaign, revision: 2, name: "服务器名称" };
            conflict = false;
            return fail(409, "记录已被修改");
          }
          campaign = { ...campaign, ...body, revision: campaign.revision + 1 };
        }
        return ok(campaign);
      }
      if (path.endsWith("/slots/home")) return ok(slot);
      if (path.endsWith("/placements/ADPL-1")) {
        if (init?.method === "DELETE") {
          placementDeleted = true;
          return ok(null);
        }
        if (init?.method === "PATCH") {
          if (conflict) {
            placement = { ...placement, revision: 2 };
            conflict = false;
            return fail(409, "记录已被修改，请刷新后重试");
          }
          placement = {
            ...placement,
            ...body,
            revision: placement.revision + 1,
          };
        }
        return ok(placement);
      }
      if (path.endsWith("/placements") && init?.method === "POST") {
        placement = { ...placement, ...body };
        return ok(placement);
      }
      if (path === "/api/admin/ads/creatives") {
        if (creativeListFails) return fail(502, "素材列表加载失败");
        if (otherCreative) return ok({
          items: url.searchParams.get("page") === "2" ? [otherCreative] : [creative],
          page: Number(url.searchParams.get("page") ?? 1), pageSize: 20, total: 21,
        });
        return ok(page([creative]));
      }
      if (path === "/api/admin/ads/campaigns") return ok(page([campaign]));
      if (path.endsWith("/ads/slots")) return ok(page([slot]));
      if (path.endsWith("/ads/placements"))
        return ok(page(placementDeleted ? [] : [placement]));
      return fail(404, `Unexpected request ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("advertising administration", () => {
  it("keeps editor hierarchy and return links in the top bar across App and platform pages", async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/ads/placements/ADPL-1");
    await screen.findByRole("heading", { name: "编辑投放" });
    let navigation = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(navigation).getByText("BUAA ClassHopper")).toBeTruthy();
    expect(within(navigation).getByText("广告投放")).toBeTruthy();
    expect(within(navigation).getByText("编辑投放").getAttribute("aria-current")).toBe("page");
    const back = screen.getByRole("link", { name: "返回列表" });
    expect(back.closest("header")).toBeTruthy();
    await user.click(back);
    expect(await screen.findByRole("heading", { name: "广告投放" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "返回列表" })).toBeNull();
    expect(screen.queryByRole("group", { name: "页面操作" })).toBeNull();
    await act(() => router.navigate("/admin/ads/creatives/new"));
    await screen.findByRole("heading", { name: "新建素材" });
    navigation = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(navigation).getByText("平台广告")).toBeTruthy();
    expect(within(navigation).getByText("共享素材")).toBeTruthy();
    expect(within(navigation).getByText("新建素材")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回列表" }).getAttribute("href")).toBe("/admin/ads/creatives");
  });
  it("opens shared libraries without an App and keeps shared drafts across pages", async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/ads/creatives/ADCR-1");
    const title = await screen.findByLabelText("标题");
    const deleteButton = screen.getByRole("button", { name: "删除" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.dataset.variant).toBe("outline");
    await user.clear(title);
    await user.type(title, "未保存的素材");
    await user.click(screen.getByRole("link", { name: "广告活动" }));
    expect(
      await screen.findByRole("heading", { name: "广告活动" }),
    ).toBeTruthy();
    await act(() => router.navigate("/admin/ads/creatives/ADCR-1"));
    expect(
      ((await screen.findByLabelText("标题")) as HTMLInputElement).value,
    ).toBe("未保存的素材");
    expect(writes).toHaveLength(0);
  });
  it("protects unsaved input across platform/App scopes and from background refresh", async () => {
    const user = userEvent.setup();
    const { client, router } = renderAdmin("/admin/ads/campaigns/ADCA-1");
    const input = await screen.findByLabelText("活动名称");
    await user.clear(input);
    await user.type(input, "我的编辑");
    await act(async () => {
      client.setQueryData(
        ["ads", "platform", "campaigns", "detail", "ADCA-1"],
        { ...campaign, name: "后台更新" },
      );
    });
    expect((screen.getByLabelText("活动名称") as HTMLInputElement).value).toBe(
      "我的编辑",
    );
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await act(() => router.navigate("/admin/buaa-classhopper/ads/placements"));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(router.state.location.pathname).toBe("/admin/ads/campaigns/ADCA-1");
    await act(() => router.navigate("/admin/buaa-classhopper/ads/placements"));
    await user.click(screen.getByRole("button", { name: "放弃更改并离开" }));
    expect(
      await screen.findByRole("heading", { name: "广告投放" }),
    ).toBeTruthy();
  });
  it("saves only the draft, shows publishing impact, and exposes read-only version content", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/ads/creatives/ADCR-1");
    const title = await screen.findByLabelText("标题");
    await user.clear(title);
    await user.type(title, "新标题");
    expect(
      (screen.getByRole("button", { name: "发布素材" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("素材草稿已保存");
    expect(creative.published!.content.title).toBe("原稿");
    expect(creative.draft.title).toBe("新标题");
    await user.click(screen.getByRole("button", { name: "发布素材" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByRole("link", {
        name: "buaa-classhopper / home",
      }),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认发布" }));
    await screen.findByText("素材已发布 · v2");
    expect(creative.published!.content.title).toBe("新标题");
    expect(await screen.findByText(/^v2 ·/)).toBeTruthy();
    expect(writes[0]!.body).not.toHaveProperty("type");
  });
  it("retains upload failures and retries without losing existing content", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/ads/creatives/ADCR-1");
    const upload = await screen.findByLabelText("素材图片");
    uploadFails = true;
    await user.upload(
      upload,
      new File(["png"], "ad.png", { type: "image/png" }),
    );
    expect(await screen.findByText("图片上传失败")).toBeTruthy();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(
      "原稿",
    );
    uploadFails = false;
    await user.upload(
      upload,
      new File(["png"], "ad.png", { type: "image/png" }),
    );
    expect(await screen.findByText("图片已上传，请保存草稿")).toBeTruthy();
  });
  it("keeps input on 409 and only adopts a new revision after explicit review", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/ads/campaigns/ADCA-1");
    const input = await screen.findByLabelText("活动名称");
    await user.clear(input);
    await user.type(input, "我的名称");
    conflict = true;
    await user.click(screen.getByRole("button", { name: "保存活动" }));
    expect(await screen.findByText("版本冲突，编辑内容已保留")).toBeTruthy();
    expect((screen.getByLabelText("活动名称") as HTMLInputElement).value).toBe(
      "我的名称",
    );
    await user.click(
      await screen.findByRole("button", { name: "保留编辑，采用最新版本号" }),
    );
    await user.click(screen.getByRole("button", { name: "保存活动" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.body).toMatchObject({ revision: 2, name: "我的名称" });
  });
  it("prefills campaign, saves a single deep-link URL and clears it to null", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-1");
    expect(await within(await screen.findByRole("group", { name: "已选活动" })).findByText("推广活动")).toBeTruthy();
    expect(screen.getByText("高级设置").closest("details")!.open).toBe(false);
    await user.click(screen.getByRole("button", { name: "选择广告位" }));
    let picker = await screen.findByRole("dialog", { name: "选择广告位" });
    await user.click(await within(picker).findByRole("button", { name: /选择广告位：首页/ }));
    await user.click(screen.getByRole("button", { name: "选择素材" }));
    picker = await screen.findByRole("dialog", { name: "选择素材" });
    await user.click(await within(picker).findByRole("button", { name: /选择素材：共享图片/ }));
    expect(within(screen.getByRole("group", { name: "已选素材" })).getByRole("img", { name: "共享图片预览" }).getAttribute("src")).toBe(image);
    await user.type(
      screen.getByLabelText("点击地址（可选）"),
      "buaa-classhopper://annoucement/ANNC-1",
    );
    await user.click(screen.getByRole("button", { name: "保存投放" }));
    await screen.findByRole("heading", { name: "编辑投放" });
    expect(writes[0]!.body).toMatchObject({
      targetUrl: "buaa-classhopper://annoucement/ANNC-1",
      campaignId: "ADCA-1",
      startsAt: null,
      endsAt: null,
    });
    expect(writes[0]!.body).not.toHaveProperty("action");
    expect(
      screen.queryByRole("link", { name: /buaa-classhopper:\/\// }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("点击地址（可选）"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "保存投放" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.body.targetUrl).toBeNull();
  });
  it("loads selected details without opening a library and previews the published creative", async () => {
    creative.draft = { ...creative.draft, title: "未发布的新标题", imageUrl: `${image}?draft` };
    renderAdmin("/admin/buaa-classhopper/ads/placements/ADPL-1");
    const summary = await screen.findByRole("group", { name: "已选素材" });
    expect(await within(summary).findByText("原稿")).toBeTruthy();
    expect(within(summary).getByText("有未发布更改")).toBeTruthy();
    expect(within(summary).queryByText("未发布的新标题")).toBeNull();
    expect(within(summary).getByRole("img").getAttribute("src")).toBe(image);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/ads/creatives?"))).toBe(false);
    expect(writes).toHaveLength(0);
  });
  it("selects a creative from a later page and retains its full summary after the drawer closes", async () => {
    const user = userEvent.setup();
    secondCreative = { ...creative, id: "ADCR-2", name: "第二页素材", publishedVersion: null, published: null };
    renderAdmin("/admin/buaa-classhopper/ads/placements/new");
    await user.click(await screen.findByRole("button", { name: "选择素材" }));
    const drawer = await screen.findByRole("dialog", { name: "选择素材" });
    await within(drawer).findByText("共享图片");
    await user.click(within(drawer).getByRole("button", { name: "下一页" }));
    await user.click(await within(drawer).findByRole("button", { name: /选择素材：第二页素材/ }));
    const summary = screen.getByRole("group", { name: "已选素材" });
    expect(within(summary).getByText("第二页素材")).toBeTruthy();
    expect(within(summary).getByText("未发布")).toBeTruthy();
    expect(within(summary).getByRole("img").getAttribute("src")).toBe(image);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).toHaveLength(0);
  });
  it("keeps the selected creative when the drawer fails, retries, or is dismissed", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/ads/placements/ADPL-1");
    await screen.findByText("共享图片");
    creativeListFails = true;
    await user.click(screen.getByRole("button", { name: "更换素材" }));
    const drawer = await screen.findByRole("dialog", { name: "选择素材" });
    expect(await within(drawer).findByText("素材列表加载失败")).toBeTruthy();
    creativeListFails = false;
    await user.click(within(drawer).getByRole("button", { name: "重试加载素材" }));
    const selected = await within(drawer).findByRole("button", { name: /选择素材：共享图片/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    await user.click(within(drawer).getByRole("button", { name: "关闭素材选择" }));
    expect(within(screen.getByRole("group", { name: "已选素材" })).getByText("共享图片")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });
  it("validates required relations before saving an empty placement", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/ads/placements/new");
    await user.click(await screen.findByRole("button", { name: "保存投放" }));
    expect(await screen.findByText("请选择活动、广告位和素材")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });
  it("keeps existing placement dates while collapsed and allows clearing them in advanced settings", async () => {
    const user = userEvent.setup();
    placement.startsAt = "2026-10-23T00:00:00.000Z";
    placement.endsAt = "2026-10-24T00:00:00.000Z";
    renderAdmin("/admin/buaa-classhopper/ads/placements/ADPL-1");
    const summary = await screen.findByText("高级设置");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("已设置投放时间")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "保存投放" }));
    await screen.findByText("已保存");
    expect(writes[0]!.body).toMatchObject({
      startsAt: "2026-10-23T00:00:00.000Z",
      endsAt: "2026-10-24T00:00:00.000Z",
    });
    await user.click(summary);
    expect(details.open).toBe(true);
    fireEvent.change(screen.getByLabelText("开始时间（上海时间，可选）"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("结束时间（上海时间，可选）"), { target: { value: "" } });
    await user.click(summary);
    await user.click(screen.getByRole("button", { name: "保存投放" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.body).toMatchObject({ startsAt: null, endsAt: null });
  });
  it("toggles placements from the rightmost action menu using the latest revision", async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/ads/placements");
    const trigger = await screen.findByRole("button", { name: "投放操作：ADPL-1" });
    expect(screen.getAllByRole("columnheader").at(-1)!.textContent).toBe("操作");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "启用" }));
    await screen.findByText("投放已启用");
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "停用" }));
    await screen.findByText("投放已停用");
    expect(writes.map((w) => w.body)).toEqual([
      { revision: 1, enabled: true },
      { revision: 2, enabled: false },
    ]);
    expect(router.state.location.pathname).toBe("/admin/buaa-classhopper/ads/placements");
  });
  it("refreshes a conflicting placement without automatically retrying the action", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/ads/placements");
    const trigger = await screen.findByRole("button", { name: "投放操作：ADPL-1" });
    conflict = true;
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "启用" }));
    await screen.findByText("记录已被修改，请刷新后重试");
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    expect(writes).toHaveLength(1);
    expect(placement.enabled).toBe(false);
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "启用" }));
    await screen.findByText("投放已启用");
    expect(writes[1]!.body).toEqual({ revision: 2, enabled: true });
  });
  it("requires confirmation to delete even an enabled placement and refreshes the empty list", async () => {
    const user = userEvent.setup();
    placement.enabled = true;
    renderAdmin("/admin/buaa-classhopper/ads/placements");
    const trigger = await screen.findByRole("button", { name: "投放操作：ADPL-1" });
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "删除" }).className).toContain("text-destructive");
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(writes).toHaveLength(0);
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await screen.findByText("投放已删除");
    const empty = await screen.findByText("暂无记录");
    expect(empty.getAttribute("colspan")).toBe("5");
    expect(writes[0]).toMatchObject({
      url: "/api/admin/buaa-classhopper/ads/placements/ADPL-1",
      body: { revision: 1 },
    });
  });
  it("isolates new placement drafts by the campaign entry link", async () => {
    const { router } = renderAdmin(
      "/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-1",
    );
    await screen.findByRole("group", { name: "已选活动" });
    fireEvent.change(screen.getByLabelText("点击地址（可选）"), {
      target: { value: "myapp://first" },
    });
    await act(() =>
      router.navigate(
        "/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-2",
      ),
    );
    expect(await within(await screen.findByRole("group", { name: "已选活动" })).findByText("第二活动")).toBeTruthy();
    expect(
      (screen.getByLabelText("点击地址（可选）") as HTMLInputElement).value,
    ).toBe("");
    await act(() =>
      router.navigate(
        "/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-1",
      ),
    );
    expect(
      (screen.getByLabelText("点击地址（可选）") as HTMLInputElement).value,
    ).toBe("myapp://first");
  });
  it("retains the ads section while switching Apps and supports slot deep links", async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/ads/slots/home");
    expect(
      await screen.findByRole("heading", { name: "编辑广告位" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("广告位标识") as HTMLInputElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("combobox", { name: "选择应用" }));
    await user.click(screen.getByRole("option", { name: "Second App" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/admin/second-app/ads/slots",
      ),
    );
  });
});
