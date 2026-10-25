import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PolicyConfig } from "../../src/domains/buaa-classhopper/access-policy/schema";
import { renderAdmin, apps, ok } from "./test-utils";
import { act } from "@testing-library/react";

const policy: PolicyConfig = { revision: 1, segmentIds: [] };

let requestMock = vi.fn<typeof fetch>();
beforeEach(() => {
  requestMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/announcement/tags") ? Promise.resolve(ok({ items: [] })) : requestMock(input, init));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("application management shell", () => {
  it("provides common capabilities for another app without BUAA-specific UI or URLs", async () => {
    const fetchMock = mockFetch().mockResolvedValueOnce(Response.json({ code: 1, msg: "成功", data: { items: [], page: 1, pageSize: 20, total: 0 } }));
    renderAdmin("/admin/second-app/");
    await screen.findByText("暂无公告");
    expect(screen.queryByRole("button", { name: "白名单管理" })).toBeNull();
    expect(screen.getAllByText("Second App").length).toBeGreaterThan(0);
    expect(document.title).toBe("Second App / 应用管理");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/second-app/announcement?page=1&pageSize=20");
  });

  it("switches apps via the sidebar without carrying resource IDs, and falls back from unsupported sections", async () => {
    mockFetch().mockImplementation(async (input) => String(input).includes("access-policy") ? policyResponse(policy) : ok({ items: [], page: 1, pageSize: 20, total: 0 }));
    const user = userEvent.setup();
    const { router } = renderAdmin();
    await screen.findByRole("heading", { name: "白名单管理" });
    await user.click(screen.getByRole("combobox", { name: "选择应用" }));
    await user.click(screen.getByRole("option", { name: "Second App" }));
    await screen.findByText("暂无公告");
    expect(router.state.location.pathname).toBe("/admin/second-app/announcements");
    await user.click(screen.getByRole("combobox", { name: "选择应用" }));
    await user.click(screen.getByRole("option", { name: "BUAA ClassHopper" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/buaa-classhopper/announcements"));
    await user.click(screen.getByRole("link", { name: "新增公告" }));
    await screen.findByLabelText("公告标题");
    await user.click(screen.getByRole("combobox", { name: "选择应用" }));
    await user.click(screen.getByRole("option", { name: "Second App" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/second-app/announcements"));
  });

  it("opens a mobile navigation sheet with keyboard controls", async () => {
    vi.stubGlobal("innerWidth", 390);
    const user = userEvent.setup();
    renderAdmin("/admin/");
    const toggle = await screen.findByRole("button", { name: "切换侧边栏" });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "应用导航" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "选择应用" })).not.toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("loads the app directory without choosing an app and rejects unknown apps", async () => {
    mockFetch().mockResolvedValueOnce(ok({ items: apps }));
    const { router } = renderAdmin("/admin/", false);
    await screen.findByText("从侧边栏选择一个应用，开始管理。");
    expect(mockFetch().mock.calls[0]?.[0]).toBe("/api/admin/apps");
    await act(() => router.navigate("/admin/not-registered/"));
    expect(await screen.findByRole("heading", { name: "页面或应用不存在" })).not.toBeNull();
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

});

function mockFetch() { return requestMock; }
function policyResponse(data: PolicyConfig) { return ok(data); }
