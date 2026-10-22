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
let conflict = false,
  uploadFails = false;
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        if (init?.method === "PATCH")
          placement = {
            ...placement,
            ...body,
            revision: placement.revision + 1,
          };
        return ok(placement);
      }
      if (path.endsWith("/placements") && init?.method === "POST") {
        placement = { ...placement, ...body };
        return ok(placement);
      }
      if (path === "/api/admin/ads/creatives") return ok(page([creative]));
      if (path === "/api/admin/ads/campaigns") return ok(page([campaign]));
      if (path.endsWith("/ads/slots")) return ok(page([slot]));
      if (path.endsWith("/ads/placements")) return ok(page([placement]));
      return fail(404, `Unexpected request ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("advertising administration", () => {
  it("opens shared libraries without an App and keeps shared drafts across pages", async () => {
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/ads/creatives/ADCR-1");
    const title = await screen.findByLabelText("标题");
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
    await screen.findByRole("option", { name: /推广活动/ });
    expect((screen.getByLabelText("活动") as HTMLSelectElement).value).toBe(
      "ADCA-1",
    );
    await user.selectOptions(screen.getByLabelText("广告位"), "home");
    await user.selectOptions(screen.getByLabelText("素材"), "ADCR-1");
    await user.type(
      screen.getByLabelText("点击地址（可选）"),
      "buaa-classhopper://annoucement/ANNC-1",
    );
    await user.click(screen.getByRole("button", { name: "保存投放" }));
    await screen.findByRole("heading", { name: "编辑投放" });
    expect(writes[0]!.body).toMatchObject({
      targetUrl: "buaa-classhopper://annoucement/ANNC-1",
      campaignId: "ADCA-1",
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
  it("isolates new placement drafts by the campaign entry link", async () => {
    const { router } = renderAdmin(
      "/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-1",
    );
    await screen.findByLabelText("活动");
    fireEvent.change(screen.getByLabelText("点击地址（可选）"), {
      target: { value: "myapp://first" },
    });
    await act(() =>
      router.navigate(
        "/admin/buaa-classhopper/ads/placements/new?campaignId=ADCA-2",
      ),
    );
    expect((screen.getByLabelText("活动") as HTMLSelectElement).value).toBe(
      "ADCA-2",
    );
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
