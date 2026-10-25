import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdmin, ok, fail } from "../../test-utils";
import { emptyMembers, type Segment } from "../../../../src/features/segments/schema";

const path = "/admin/segments", base = "/api/admin/segments";
const id = "SEGM-20261024-AAAAAAAAAA";
let current: Segment, conflict: boolean, referenced: boolean;
beforeEach(() => {
  current = { id, name: "测试人群", members: emptyMembers(), revision: 1, counts: { student_name: 0, student_id: 0, sso_id: 0 }, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" }; conflict = false; referenced = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "https://test.invalid"), data = init?.body ? JSON.parse(init.body as string) : {};
    if (url.pathname === base && init?.method === "POST") { current = { ...current, ...data }; return ok(current); }
    if (url.pathname === `${base}/${id}`) {
      if (init?.method === "PUT") {
        if (conflict) { current.revision = 2; current.name = "服务器名称"; return fail(409, "人群已被修改"); }
        current = { ...current, ...data, revision: current.revision + 1 };
      }
      if (init?.method === "DELETE") return referenced ? fail(409, "无法删除：人群被引用或记录已变化") : ok(null);
      return ok(current);
    }
    if (url.pathname === base) return ok({ items: [current], page: 1, pageSize: 20, total: 1 });
    throw new Error(`Unexpected ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
describe("segment management", () => {
  it("creates normalized lists without a description field", async () => {
    const user = userEvent.setup(), { router } = renderAdmin(`${path}/new`);
    await screen.findByRole("heading", { name: "新建人群" });
    fireEvent.change(await screen.findByLabelText("人群名称"), { target: { value: " 内测组 " } });
    for (const label of ["姓名", "学号", "SSO ID"]) await user.click(screen.getByRole("button", { name: `新增${label}` }));
    expect(screen.getByRole("heading", { name: "新建人群" })).toBeTruthy();
    expect(screen.getAllByRole("textbox", { name: "人群名称" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "编辑人群名称" })).toBeNull();
    fireEvent.change(screen.getByLabelText("待新增姓名"), { target: { value: " 张三\n张三,李四" } });
    fireEvent.change(screen.getByLabelText("待新增学号"), { target: { value: "01" } });
    fireEvent.change(screen.getByLabelText("待新增SSO ID"), { target: { value: "user-1,user-1" } });
    await user.click(screen.getByRole("button", { name: "添加姓名" }));
    await user.click(screen.getByRole("button", { name: "添加学号" }));
    expect((screen.getByLabelText("待新增SSO ID") as HTMLTextAreaElement).value).toBe("user-1,user-1");
    expect(screen.queryByLabelText(/说明/)).toBeNull();
    for (const label of ["姓名", "学号", "SSO ID"]) expect(screen.getByRole("region", { name: label })).toBeTruthy();
    expect(screen.queryByLabelText("新增名单类型")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${path}/${id}`));
    await screen.findByRole("heading", { name: "内测组" });
    expect(screen.queryByRole("textbox", { name: "人群名称" })).toBeNull();
    expect(JSON.parse(writes()[0]![1]!.body as string)).toEqual({ name: "内测组", members: { student_name: ["张三", "李四"], student_id: ["01"], sso_id: ["user-1"] } });
  });
  it("edits and deletes rows in the same list before saving", async () => {
    current.members.student_id = ["01", "02"];
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    fireEvent.change(await screen.findByLabelText("编辑学号第 1 项"), { target: { value: "03" } });
    await user.click(screen.getByRole("button", { name: "搜索学号" }));
    fireEvent.change(screen.getByLabelText("查询学号"), { target: { value: "02" } });
    await user.click(screen.getByRole("button", { name: "删除学号 02" }));
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(current.members.student_id).toEqual(["03"]));
  });
  it("retains the draft on conflict and adopts revisions explicitly", async () => {
    current.members.student_id = ["01"];
    conflict = true; const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await user.click(await screen.findByRole("button", { name: "编辑人群名称" }));
    fireEvent.change(screen.getByLabelText("人群名称"), { target: { value: "我的名称" } });
    fireEvent.change(screen.getByLabelText("编辑学号第 1 项"), { target: { value: "02" } });
    await user.click(screen.getByRole("button", { name: "新增SSO ID" }));
    fireEvent.change(screen.getByLabelText("待新增SSO ID"), { target: { value: "pending-user" } });
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await screen.findByRole("button", { name: "保留编辑，采用最新修订号" });
    expect(screen.getByRole("heading", { name: "我的名称" })).toBeTruthy(); expect((screen.getByRole("button", { name: "保存人群" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("编辑学号第 1 项") as HTMLInputElement).value).toBe("02");
    expect((screen.getByLabelText("待新增SSO ID") as HTMLTextAreaElement).value).toBe("pending-user");
    conflict = false; await user.click(screen.getByRole("button", { name: "保留编辑，采用最新修订号" })); await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(writes()).toHaveLength(2)); expect(JSON.parse(writes()[1]![1]!.body as string)).toMatchObject({ revision: 2, name: "我的名称", members: { student_id: ["02"], sso_id: ["pending-user"] } });
  });
  it("paginates each column and keeps a searched row editable until focus leaves", async () => {
    current.members.student_id = Array.from({ length: 21 }, (_, i) => String(i + 1).padStart(2, "0"));
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await screen.findByLabelText("编辑学号第 1 项");
    expect(screen.queryByLabelText("编辑学号第 21 项")).toBeNull();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect((screen.getByLabelText("编辑学号第 21 项") as HTMLInputElement).value).toBe("21");
    await user.click(screen.getByRole("button", { name: "搜索学号" }));
    await user.type(screen.getByLabelText("查询学号"), "21");
    const row = screen.getByLabelText("编辑学号第 1 项");
    await user.clear(row); await user.type(row, "22");
    expect((row as HTMLInputElement).value).toBe("22"); expect(document.activeElement).toBe(row);
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(current.members.student_id).toContain("22")); expect(current.members.student_id).not.toContain("21");
  });
  it("protects pending additions on refresh and keeps values independent across member types", async () => {
    current.members.student_id = ["01"];
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await user.click(await screen.findByRole("button", { name: "新增SSO ID" }));
    await user.type(screen.getByLabelText("待新增SSO ID"), "01");
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "添加SSO ID" }));
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(current.members).toEqual({ student_name: [], student_id: ["01"], sso_id: ["01"] }));
  });
  it("opens search from each column header and clears filters when collapsed", async () => {
    current.members.student_name = ["张三", "李四"];
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await screen.findByRole("button", { name: "搜索姓名" });
    for (const label of ["姓名", "学号", "SSO ID"]) expect(screen.queryByLabelText(`查询${label}`)).toBeNull();
    await user.click(screen.getByRole("button", { name: "搜索姓名" }));
    const input = screen.getByLabelText("查询姓名"); expect(document.activeElement).toBe(input);
    await user.type(input, "张"); expect(screen.queryByRole("button", { name: "删除姓名 李四" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "收起姓名搜索" }));
    expect(screen.queryByLabelText("查询姓名")).toBeNull(); expect(screen.getByRole("button", { name: "删除姓名 李四" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "搜索学号" }));
    expect(document.activeElement).toBe(screen.getByLabelText("查询学号"));
    await user.keyboard("{Escape}"); expect(document.activeElement).toBe(screen.getByRole("button", { name: "搜索学号" }));
    await user.click(screen.getByRole("button", { name: "搜索SSO ID" }));
    expect(document.activeElement).toBe(screen.getByLabelText("查询SSO ID"));
  });
  it("opens additions from column headers and preserves pending input when collapsed", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await screen.findByRole("button", { name: "新增姓名" });
    for (const label of ["姓名", "学号", "SSO ID"]) expect(screen.queryByLabelText(`待新增${label}`)).toBeNull();
    await user.click(screen.getByRole("button", { name: "新增姓名" }));
    const input = screen.getByLabelText("待新增姓名"); expect(document.activeElement).toBe(input);
    await user.type(input, "张三"); await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("待新增姓名")).toBeNull(); expect(document.activeElement).toBe(screen.getByRole("button", { name: "新增姓名" }));
    await user.click(screen.getByRole("button", { name: "新增姓名" }));
    expect((screen.getByLabelText("待新增姓名") as HTMLTextAreaElement).value).toBe("张三");
    await user.click(screen.getByRole("button", { name: "收起姓名新增" }));
    await user.click(screen.getByRole("button", { name: "新增学号" }));
    expect(document.activeElement).toBe(screen.getByLabelText("待新增学号"));
    await user.type(screen.getByLabelText("待新增学号"), "01");
    await user.click(screen.getByRole("button", { name: "添加学号" }));
    expect(document.activeElement).toBe(screen.getByLabelText("待新增学号"));
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(current.members).toEqual({ student_name: ["张三"], student_id: ["01"], sso_id: [] }));
  });
  it("edits the name from the title or edit button without a duplicate name field", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await screen.findByRole("heading", { name: "测试人群" });
    expect(screen.queryByRole("textbox", { name: "人群名称" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "测试人群" }));
    const input = screen.getByRole("textbox", { name: "人群名称" }); expect(document.activeElement).toBe(input);
    await user.clear(input); await user.type(input, "新的名称{Enter}");
    expect(screen.queryByRole("textbox", { name: "人群名称" })).toBeNull();
    expect(screen.getByRole("heading", { name: "新的名称" })).toBeTruthy(); expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "编辑人群名称" }));
    await user.clear(screen.getByRole("textbox", { name: "人群名称" }));
    await user.type(screen.getByRole("textbox", { name: "人群名称" }), "取消修改{Escape}");
    expect(screen.getByRole("heading", { name: "新的名称" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存人群" }));
    await waitFor(() => expect(current.name).toBe("新的名称"));
  });
  it("keeps an empty name editable and closes the title editor on blur", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/${id}`);
    await user.click(await screen.findByRole("button", { name: "编辑人群名称" }));
    const input = screen.getByRole("textbox", { name: "人群名称" });
    await user.clear(input); await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "人群名称" })).toBe(input); expect(writes()).toHaveLength(0);
    await user.type(input, "失焦后保留");
    await user.click(screen.getByRole("button", { name: "新增姓名" }));
    expect(screen.queryByRole("textbox", { name: "人群名称" })).toBeNull(); expect(screen.getByRole("heading", { name: "失焦后保留" })).toBeTruthy();
  });
  it("shows generic delete protection without fetching consumer references", async () => {
    referenced = true; const user = userEvent.setup(); renderAdmin(path);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await screen.findByText("无法删除：人群被引用或记录已变化");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/references"))).toBe(false);
  });
});
