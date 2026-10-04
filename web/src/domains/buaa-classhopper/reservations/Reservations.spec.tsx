import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ok, renderAdmin } from "../../../test-utils";

const reservation = {
  id: "reservation-1", userId: "user-1", loginName: "student123", studentId: "23370001", studentName: "张三",
  course: {
    id: "12345", courseId: "678", courseName: "高等数学", courseNum: "D211042002", classroomName: "B118",
    classBeginTime: "2099-10-05T01:00:00.000Z", classEndTime: "2099-10-05T02:30:00.000Z",
  },
  status: "QUEUED", nextAttemptAt: null, attemptCount: 0, completedAt: null,
  resultMessage: null, resultCode: null, resultData: null,
  createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:01.000Z",
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reservation management", () => {
  it("opens the recorded check-in steps from the status cell", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/reservation-1/events")
      ? ok({ items: [
        { kind: "SUBMITTED", scheduleVersion: 1, occurredAt: "2026-10-02T00:00:00.000Z" },
        { kind: "SCHEDULED", scheduleVersion: 1, occurredAt: "2026-10-02T00:00:01.000Z",
          scheduledFor: "2099-10-05T00:52:00.000Z", referenceId: "reservation-1-1" },
        { kind: "ATTEMPT_STARTED", scheduleVersion: 1, occurredAt: "2099-10-05T00:52:00.000Z",
          attemptNumber: 1, referenceId: "reservation-1:1:1" },
        { kind: "RESULT_FAILED", scheduleVersion: 1, occurredAt: "2099-10-05T00:52:05.000Z",
          referenceId: "reservation-1:1:1", message: "网络失败", scheduledFor: "2099-10-05T00:52:35.000Z" },
        { kind: "ATTEMPT_STARTED", scheduleVersion: 1, occurredAt: "2099-10-05T00:52:35.000Z",
          attemptNumber: 2, referenceId: "reservation-1:1:2" },
      ] })
      : ok({ items: [reservation], page: 1, pageSize: 10, total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");
    const openFlow = await screen.findByRole("button", { name: "查看签到流程：reservation-1" });
    await user.click(openFlow);
    const flow = screen.getByRole("dialog", { name: "签到流程" });
    expect(await within(flow).findByText("第 1 次签到")).not.toBeNull();
    expect(within(flow).getByText("第 2 次签到")).not.toBeNull();
    const steps = within(flow).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(within(steps[1]!).getByText("第 1 次签到")).not.toBeNull();
    expect(within(steps[1]!).getByText("网络失败")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reservation-1/events"))).toBe(true);
  });

  it("shows a separate current node while waiting to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/reservation-1/events")
      ? ok({ items: [
        { kind: "ATTEMPT_STARTED", scheduleVersion: 1, occurredAt: "2026-10-02T00:00:00.000Z", attemptNumber: 1 },
        { kind: "RESULT_FAILED", scheduleVersion: 1, occurredAt: "2026-10-02T00:00:05.000Z",
          scheduledFor: "2099-10-05T00:52:35.000Z", message: "签到失败" },
      ] })
      : ok({ items: [{ ...reservation, status: "QUEUED", nextAttemptAt: "2099-10-05T00:52:35.000Z" }],
        page: 1, pageSize: 10, total: 1 })));
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");
    await user.click(await screen.findByRole("button", { name: "查看签到流程：reservation-1" }));
    const flow = screen.getByRole("dialog", { name: "签到流程" });
    expect(await within(flow).findByText("等待下次签到")).not.toBeNull();
    const steps = within(flow).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(steps[0]?.getAttribute("data-stage")).toBe("current");
    expect(steps[1]?.getAttribute("data-stage")).toBe("completed");
    expect(within(steps[1]!).getByText("签到失败")).not.toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "预约操作：reservation-1" }));
    expect(await screen.findByRole("menuitem", { name: "取消预约" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "立即签到" })).not.toBeNull();
  });

  it("does not show a stale retry time after a later result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/reservation-1/events")
      ? ok({ items: [
        { kind: "ATTEMPT_STARTED", scheduleVersion: 1, occurredAt: "2026-10-03T02:52:03.000Z",
          attemptNumber: 3, referenceId: "reservation-1:1:3" },
        { kind: "RESULT_FAILED", scheduleVersion: 1, occurredAt: "2026-10-03T02:52:04.000Z",
          referenceId: "reservation-1:1:3", message: "当前时间不是上课时间" },
      ] })
      : ok({ items: [{ ...reservation, status: "QUEUED", nextAttemptAt: "2026-10-03T02:51:02.000Z" }],
        page: 1, pageSize: 10, total: 1 })));
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");
    await user.click(await screen.findByRole("button", { name: "查看签到流程：reservation-1" }));
    const flow = screen.getByRole("dialog", { name: "签到流程" });
    expect(await within(flow).findByText("当前时间不是上课时间")).not.toBeNull();
    expect(within(flow).getAllByRole("listitem")).toHaveLength(1);
    expect(within(flow).queryByText("等待下次签到")).toBeNull();
  });

  it("shows an active attempt as in progress without cancellation actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ items: [{ ...reservation, status: "IN_PROGRESS" }],
      page: 1, pageSize: 10, total: 1 })));
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");
    const trigger = await screen.findByRole("button", { name: "预约操作：reservation-1" });
    expect(screen.getByRole("button", { name: "查看签到流程：reservation-1" }).textContent).toContain("签到中");
    await user.click(trigger);
    expect(screen.queryByRole("menuitem", { name: "取消预约" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "立即签到" })).toBeNull();
  });

  it("shows all users and keeps pagination in the URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const page = new URL(String(input), "https://example.com").searchParams.get("page");
      return ok({ items: [page === "2" ? { ...reservation, id: "reservation-2", userId: "user-2" } : reservation],
        page: Number(page), pageSize: 10, total: 11 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/reservations");
    expect(await screen.findByRole("button", { name: "查看用户详情：张三 - 23370001" })).not.toBeNull();
    expect(screen.getByText("reservation-1")).not.toBeNull();
    expect(screen.getByText("高等数学")).not.toBeNull();
    expect(screen.queryByText("查看用户信息")).toBeNull();
    expect(screen.queryByText(/更新 2026/)).toBeNull();
    expect(screen.getByRole("link", { name: "签到预约" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("reservation-2")).not.toBeNull();
    expect(router.state.location.search).toBe("?page=2");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/admin/buaa-classhopper/reservations?page=1&pageSize=10",
      "/api/admin/buaa-classhopper/reservations?page=2&pageSize=10",
    ]);
  });

  it("applies search and status filters and preserves them across pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const params = new URL(String(input), "https://example.com").searchParams;
      return ok({ items: [{ ...reservation, status: params.get("status") || "QUEUED" }],
        page: Number(params.get("page")), pageSize: 10, total: 11 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { router } = renderAdmin("/admin/buaa-classhopper/reservations");
    await screen.findByRole("button", { name: "查看用户详情：张三 - 23370001" });
    await user.type(screen.getByRole("searchbox", { name: "搜索预约" }), "张三");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("search")).toBe("张三"));
    await user.click(screen.getByRole("combobox", { name: "状态" }));
    await user.click(await screen.findByRole("option", { name: "已完成" }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("status")).toBe("SUCCESS"));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("page")).toBe("2"));
    expect(fetchMock.mock.calls.some(([url]) => {
      const query = new URL(String(url), "https://example.com").searchParams;
      return query.get("page") === "2" && query.get("search") === "张三" && query.get("status") === "SUCCESS";
    })).toBe(true);
    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(router.state.location.search).toBe("?page=1");
  });

  it("opens user and course details from their summary cells", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ items: [reservation], page: 1, pageSize: 10, total: 1 })));
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");

    await user.click(await screen.findByRole("button", { name: "查看用户详情：张三 - 23370001" }));
    expect(screen.queryByRole("columnheader", { name: "执行结果" })).toBeNull();
    const userDialog = screen.getByRole("dialog", { name: "用户详情" });
    expect(within(userDialog).getByText("student123")).not.toBeNull();
    expect(within(userDialog).getByText("user-1")).not.toBeNull();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "查看课程详情：高等数学" }));
    const courseDialog = screen.getByRole("dialog", { name: "课程详情" });
    expect(within(courseDialog).getByText("D211042002")).not.toBeNull();
    expect(within(courseDialog).getByText("B118")).not.toBeNull();
    expect(within(courseDialog).getByText("12345")).not.toBeNull();
    expect(within(courseDialog).getByText("678")).not.toBeNull();
  });

  it("offers administrator actions and confirms permanent deletion", async () => {
    let item: typeof reservation | null = reservation;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path.endsWith("/cancel")) item = { ...reservation, status: "CANCELLED" };
      if (init?.method === "DELETE") { item = null; return ok({ id: reservation.id }); }
      if (init?.method === "POST") return ok(item);
      return ok({ items: item ? [item] : [], page: 1, pageSize: 10, total: item ? 1 : 0 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin("/admin/buaa-classhopper/reservations");
    const trigger = await screen.findByRole("button", { name: "预约操作：reservation-1" });
    expect(screen.queryByRole("menuitem", { name: "取消预约" })).toBeNull();
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "取消预约" }));
    await screen.findByText("预约已取消");
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "恢复预约" })).not.toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("暂无预约记录")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/cancel") && init?.method === "POST")).toBe(true);
  });
});
