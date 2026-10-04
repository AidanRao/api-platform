import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fail, ok, renderAdmin } from "../../test-utils";

const tokenValue = "apt_" + "a".repeat(43);
const metadata = {
  id: "token-1", appId: "buaa-classhopper", name: "签到服务",
  permissions: ["reservations:read"], expiresAt: null, revokedAt: null as string | null,
  createdBy: "admin-1", createdAt: "2026-10-02T00:00:00.000Z",
};
const catalog = { groups: [{
  code: "reservations", name: "签到预约", permissions: [
    { code: "reservations:read", name: "读取签到预约详情" },
    { code: "reservations:result:write", name: "回传签到结果" },
  ],
}] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("API Token management", () => {
  it("creates, reveals once, lists metadata, and revokes a token", async () => {
    let items: typeof metadata[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/permissions")) return ok(catalog);
      if (init?.method === "POST") { items = [metadata]; return ok({ ...metadata, token: tokenValue }); }
      if (init?.method === "DELETE") {
        items = [{ ...metadata, revokedAt: "2026-10-02T01:00:00.000Z" }];
        return ok(items[0]);
      }
      expect(path).toBe("/api/admin/buaa-classhopper/api-tokens");
      return ok({ items });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/api-tokens");
    await screen.findByText("暂无 API Token");
    expect(screen.queryByLabelText("名称")).toBeNull();
    await user.click(screen.getByRole("link", { name: "创建 Token" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/buaa-classhopper/api-tokens/new"));
    await user.type(await screen.findByLabelText("名称"), "签到服务");
    expect(await screen.findByRole("group", { name: "签到预约" })).not.toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /读取签到预约详情/ }));
    await user.click(screen.getByRole("button", { name: "预览 Token" }));
    expect(await screen.findByRole("region", { name: "Token 创建预览" })).not.toBeNull();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("签到服务");
    await user.click(screen.getByRole("button", { name: "预览 Token" }));
    await user.click(screen.getByRole("button", { name: "确认创建 Token" }));
    expect(await screen.findByRole("region", { name: "新建 API Token" })).not.toBeNull();
    expect((screen.getByLabelText("Token 明文") as HTMLInputElement).value).toBe(tokenValue);
    expect(screen.queryByLabelText("名称")).toBeNull();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制 Token" }));
    expect(writeText).toHaveBeenCalledWith(tokenValue);
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/admin/buaa-classhopper/api-tokens");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: "签到服务", permissions: ["reservations:read"] });
    await user.click(screen.getByRole("link", { name: "返回列表" }));
    expect(router.state.location.pathname).toBe("/admin/buaa-classhopper/api-tokens");
    expect(screen.queryByLabelText("Token 明文")).toBeNull();
    await screen.findByText("签到服务");
    await user.type(screen.getByRole("textbox", { name: "搜索 Token" }), "不存在");
    expect(screen.getByText("没有匹配的 Token")).not.toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "搜索 Token" }));
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("已撤销“签到服务”")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("已撤销")).not.toBeNull());
    expect(fetchMock.mock.calls.find((call) => call[1]?.method === "DELETE")?.[0])
      .toBe("/api/admin/buaa-classhopper/api-tokens/token-1");
  });

  it("reveals a rotated token in a one-time dialog and deletes it after revocation", async () => {
    let items = [metadata];
    const rotatedValue = "apt_" + "b".repeat(43);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/permissions")) return ok(catalog);
      if (path.endsWith("/rotate") && init?.method === "POST") return ok({ ...metadata, token: rotatedValue });
      if (path.endsWith("/permanent") && init?.method === "DELETE") {
        items = [];
        return ok({ id: metadata.id });
      }
      if (path.endsWith(`/${metadata.id}`) && init?.method === "DELETE") {
        items = [{ ...metadata, revokedAt: "2026-10-02T01:00:00.000Z" }];
        return ok(items[0]);
      }
      expect(path).toBe("/api/admin/buaa-classhopper/api-tokens");
      return ok({ items });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/api-tokens");
    await screen.findByText("签到服务");
    await user.click(screen.getByRole("button", { name: "轮换" }));
    await user.click(screen.getByRole("button", { name: "确认轮换" }));
    expect((await screen.findByLabelText("轮换后的 Token 明文") as HTMLInputElement).value).toBe(rotatedValue);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "复制 Token" }));
    expect(writeText).toHaveBeenCalledWith(rotatedValue);
    await user.click(screen.getByRole("button", { name: "我已保存" }));
    expect(screen.queryByLabelText("轮换后的 Token 明文")).toBeNull();
    expect(fetchMock.mock.calls.find((call) => call[1]?.method === "POST")?.[0])
      .toBe("/api/admin/buaa-classhopper/api-tokens/token-1/rotate");
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    await screen.findByRole("button", { name: "删除" });
    expect(screen.queryByRole("button", { name: "轮换" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("暂无 API Token")).not.toBeNull();
    expect(fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/permanent"))?.[1]?.method).toBe("DELETE");
  });

  it("shows no create controls when an app has no declared permissions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      ok(String(input).endsWith("/permissions") ? { groups: [] } : { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/second-app/api-tokens");
    await screen.findByText("暂无 API Token");
    await user.click(screen.getByRole("link", { name: "创建 Token" }));
    expect(await screen.findByText("当前应用尚未配置 API Token 权限。")).not.toBeNull();
    expect((screen.getByRole("button", { name: "预览 Token" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/api/admin/second-app/api-tokens/permissions");
  });

  it("sends an optional local expiry as an ISO timestamp", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/permissions") ? ok(catalog)
        : init?.method === "POST" ? ok({ ...metadata, token: tokenValue }) : ok({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/api-tokens/new");
    await user.type(await screen.findByLabelText("名称"), "签到服务");
    await user.click(screen.getByRole("checkbox", { name: /读取签到预约详情/ }));
    await user.click(screen.getByRole("button", { name: "自定义" }));
    await user.type(screen.getByLabelText("自定义到期时间"), "2030-01-01T09:30");
    await user.click(screen.getByRole("button", { name: "预览 Token" }));
    await screen.findByRole("region", { name: "Token 创建预览" });
    await user.click(screen.getByRole("button", { name: "确认创建 Token" }));
    await screen.findByLabelText("Token 明文");
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).expiresAt).toBe(new Date("2030-01-01T09:30").toISOString());
  });

  it("offers fixed expiration choices and calculates them when creating", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/permissions") ? ok(catalog)
        : init?.method === "POST" ? ok({ ...metadata, token: tokenValue }) : ok({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/api-tokens/new");
    expect((await screen.findByRole("button", { name: "永不过期" })).getAttribute("aria-pressed")).toBe("true");
    await user.type(screen.getByLabelText("名称"), "七天令牌");
    await user.click(screen.getByRole("checkbox", { name: /读取签到预约详情/ }));
    await user.click(screen.getByRole("button", { name: "7 天" }));
    expect(screen.getByRole("button", { name: "7 天" }).getAttribute("aria-pressed")).toBe("true");
    const before = Date.now();
    await user.click(screen.getByRole("button", { name: "预览 Token" }));
    await screen.findByRole("region", { name: "Token 创建预览" });
    await user.click(screen.getByRole("button", { name: "确认创建 Token" }));
    await screen.findByLabelText("Token 明文");
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    const expiry = Date.parse(JSON.parse(String(post?.[1]?.body)).expiresAt);
    expect(expiry).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it("uses the catalog names on the token list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      ok(String(input).endsWith("/permissions") ? catalog
        : { items: [{ ...metadata, permissions: ["reservations:read", "reservations:result:write"] }] }));
    vi.stubGlobal("fetch", fetchMock);
    renderAdmin("/admin/buaa-classhopper/api-tokens");
    expect(await screen.findByText("读取签到预约详情")).not.toBeNull();
    expect(screen.getByText("回传签到结果")).not.toBeNull();
  });

  it("retries a failed permission catalog request", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/permissions")) {
        attempts += 1;
        return attempts === 1 ? fail(503, "权限目录暂不可用") : ok(catalog);
      }
      return ok({ items: [] });
    }));
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/api-tokens/new");
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByLabelText("名称")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试加载权限" }));
    expect(await screen.findByRole("group", { name: "签到预约" })).not.toBeNull();
  });
});
