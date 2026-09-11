import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessPolicy } from "../../src/domains/buaa-classhopper/access-policy.schema";
import { App } from "./App";

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

describe("whitelist management page", () => {
  it("loads the policy and disables save while there are no changes", async () => {
    mockFetch().mockResolvedValueOnce(policyResponse(policy));
    render(<App />);

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
    render(<App />);

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
    render(<App />);

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
    render(<App />);

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
    render(<App />);

    expect(await screen.findByText("白名单尚未初始化")).not.toBeNull();
    expect(screen.queryByLabelText("新增姓名")).toBeNull();
  });

  it("recognizes a non-JSON Access response as an expired login", async () => {
    mockFetch().mockResolvedValueOnce(
      new Response("<html>Access login</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    render(<App />);

    expect(
      await screen.findByText("登录状态可能已过期，请重新加载页面"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "重新加载" })).not.toBeNull();
  });

  it("shows immediate duplicate validation without sending a request", async () => {
    const fetchMock = mockFetch().mockResolvedValueOnce(policyResponse(policy));
    render(<App />);

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
