import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessPolicy } from "../../src/domains/buaa-classhopper/access-policy.schema";
import { renderAdmin, apps, ok } from "./test-utils";
import { act } from "@testing-library/react";

const policy: AccessPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001", "ZY370002"],
  names: ["张三", "李四"],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
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
    expect(document.title).toBe("Second App · 应用管理");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/second-app/announcement?page=1&pageSize=20");
  });

  it("switches apps via the sidebar without carrying resource IDs, and falls back from unsupported sections", async () => {
    mockFetch().mockImplementation(async (input) => String(input).includes("access-policy") ? policyResponse(policy) : ok({ items: [], page: 1, pageSize: 20, total: 0 }));
    const user = userEvent.setup();
    const { router } = renderAdmin();
    await screen.findByText(policy.revision);
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

describe("whitelist management page", () => {
  it("loads the policy and disables save while there are no changes", async () => {
    mockFetch().mockResolvedValueOnce(policyResponse(policy));
    renderAdmin();

    expect(await screen.findByText("2026-09-10-001")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "保存更改" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("23370001")).not.toBeNull();
    expect(screen.getByText("张三")).not.toBeNull();
  });

  it("stages an addition with Enter and saves the compact patch", async () => {
    const updated = {
      ...policy,
      revision: "2026-09-10-002",
      names: [...policy.names, "王五"],
    };
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(policyResponse(policy))
      .mockResolvedValueOnce(policyResponse(updated, "更新成功"));
    const user = userEvent.setup();
    renderAdmin();

    const input = await screen.findByLabelText("新增姓名");
    await user.type(input, "  王五  {Enter}");
    expect(screen.getByText("待新增")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    await screen.findByText("白名单已保存");
    expect(screen.getByText("2026-09-10-002")).not.toBeNull();
    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe(
      "/api/admin/buaa-classhopper/v1/iclass/access-policy",
    );
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toEqual({
      baseRevision: "2026-09-10-001",
      add: { names: ["王五"] },
    });
  });

  it("marks a deletion and can discard all local changes", async () => {
    mockFetch().mockResolvedValueOnce(policyResponse(policy));
    const user = userEvent.setup();
    renderAdmin();

    await screen.findByText("2026-09-10-001");
    const deleteButtons = screen.getAllByRole("button", { name: "删除" });
    await user.click(deleteButtons[0] as HTMLButtonElement);
    expect(screen.getByRole("button", { name: "撤销删除" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(screen.queryByRole("button", { name: "撤销删除" })).toBeNull();
  });

  it("keeps and rebases the draft after a 409 without resubmitting", async () => {
    const latest = { ...policy, revision: "2026-09-10-002", names: ["张三"] };
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(policyResponse(policy))
      .mockResolvedValueOnce(errorResponse(409, "白名单版本已更新，请刷新后重试"))
      .mockResolvedValueOnce(policyResponse(latest));
    const user = userEvent.setup();
    renderAdmin();

    await user.type(await screen.findByLabelText("新增姓名"), "王五{Enter}");
    await user.click(screen.getByRole("button", { name: "保存更改" }));

    await screen.findByText("数据已更新，请检查后再次保存");
    expect(screen.getByText("2026-09-10-002")).not.toBeNull();
    expect(screen.getByText("待新增")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "保存更改" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows an uninitialized state for 503", async () => {
    mockFetch().mockResolvedValueOnce(errorResponse(503, "白名单尚未配置"));
    renderAdmin();

    expect(await screen.findByText("白名单尚未初始化")).not.toBeNull();
    expect(screen.queryByLabelText("新增姓名")).toBeNull();
  });

  it("opens announcements even when the whitelist is uninitialized, preserving edits across tabs", async () => {
    mockFetch().mockResolvedValueOnce(errorResponse(503, "白名单尚未配置"))
      .mockResolvedValueOnce(Response.json({ code: 1, msg: "成功", data: { items: [], page: 1, pageSize: 20, total: 0 } }));
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("白名单尚未初始化");
    await user.click(screen.getByRole("link", { name: "公告管理" }));
    await user.click(await screen.findByRole("link", { name: "新增公告" }));
    await user.type(await screen.findByLabelText("公告标题"), "未保存草稿");
    await user.click(screen.getByRole("link", { name: "白名单管理" }));
    await user.click(screen.getByRole("link", { name: "公告管理" }));
    await user.click(await screen.findByRole("link", { name: "新增公告" }));
    expect((await screen.findByLabelText("公告标题") as HTMLInputElement).value).toBe("未保存草稿");
  });

  it("recognizes a non-JSON Access response as an expired login", async () => {
    mockFetch().mockResolvedValueOnce(
      new Response("<html>Access login</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    renderAdmin();

    expect(
      await screen.findByText("登录状态可能已过期，请重新加载页面"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "重新加载" })).not.toBeNull();
  });

  it("shows immediate duplicate validation without sending a request", async () => {
    const fetchMock = mockFetch().mockResolvedValueOnce(policyResponse(policy));
    renderAdmin();

    await screen.findByText("2026-09-10-001");
    fireEvent.change(screen.getByLabelText("新增姓名"), { target: { value: "张三" } });
    fireEvent.submit(screen.getByLabelText("新增姓名").closest("form") as HTMLFormElement);

    expect(screen.getByText("该项已在白名单中")).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

function mockFetch() {
  return vi.mocked(globalThis.fetch);
}

function policyResponse(data: AccessPolicy, msg = "获取成功") {
  return Response.json({ code: 1, msg, data });
}

function errorResponse(status: number, msg: string) {
  return Response.json({ code: 0, msg, data: null }, { status });
}
