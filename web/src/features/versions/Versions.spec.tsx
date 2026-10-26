import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdmin, ok, fail } from "../../test-utils";
import type { AppVersion } from "../../../../src/features/versions/schema";

const base = "/api/admin/buaa-classhopper/versions", path = "/admin/buaa-classhopper/versions", segmentId = "SEGM-20261024-AAAAAAAAAA";
const initial: AppVersion = { versionCode: 1, version: "1.4.1", releaseType: "gray", releaseNotes: "## 更新说明", packageInfo: null, revision: 1, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z", segmentIds: [] };
let items: AppVersion[], latestVersion: string | null, revision: number, conflict: boolean;
beforeEach(() => {
  items = [{ ...initial, segmentIds: [] }, { ...initial, version: "1.5.0", segmentIds: [] }]; latestVersion = null; revision = 1; conflict = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "https://test.invalid"), method = init?.method ?? "GET", data = init?.body ? JSON.parse(init.body as string) : {};
    if (url.pathname === "/api/admin/segments") return ok({ items: [{ id: segmentId, name: "内测人群", revision: 1, counts: { student_name: 0, student_id: 0, sso_id: 2 }, createdAt: initial.createdAt, updatedAt: initial.updatedAt }], page: 1, pageSize: 20, total: 1 });
    if (url.pathname === `${base}/latest`) { if (method === "PUT") { latestVersion = data.version; revision++; } return ok({ latestVersion, revision }); }
    if (url.pathname === base) {
      if (method === "POST") { const item = { ...initial, ...data }; items.push(item); return ok(item); }
      return ok({ items, total: items.length, page: Number(url.searchParams.get("page")), pageSize: Number(url.searchParams.get("pageSize")) });
    }
    const version = url.pathname.slice(base.length + 1).split("/")[0], item = items.find((v) => v.version === version);
    if (item) {
      if (method === "PATCH" || method === "PUT") {
        if (conflict) { item.revision = 2; item.releaseNotes = "服务器更新说明"; return fail(409, "版本已被修改"); }
        Object.assign(item, data, { revision: item.revision + 1 });
        if (item.releaseType === "full") item.segmentIds = [];
      }
      if (method === "DELETE") { items = items.filter((v) => v !== item); return ok(null); }
      return ok(item);
    }
    throw new Error(`Unexpected request ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
async function chooseSegment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "添加人群" }));
  const sheet = within(await screen.findByRole("dialog", { name: "选择人群" }));
  await user.click(await sheet.findByRole("checkbox", { name: /内测人群/ }));
  await user.click(sheet.getByRole("button", { name: "完成" }));
}

describe("version management", () => {
  it("creates version metadata with Markdown preview", async () => {
    const user = userEvent.setup(), { router } = renderAdmin(`${path}/new`);
    expect((await screen.findByRole("radio", { name: "灰度" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(await screen.findByLabelText("版本号"), { target: { value: "1.6.0" } });
    fireEvent.change(screen.getByLabelText("versionCode"), { target: { value: "2" } });
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    fireEvent.change(screen.getByLabelText("下载地址"), { target: { value: "https://cdn.example.com/app.apk" } });
    fireEvent.change(screen.getByLabelText("SHA-256"), { target: { value: "a".repeat(64) } });
    fireEvent.change(screen.getByLabelText("文件大小（字节）"), { target: { value: "1000" } });
    await user.click(screen.getByRole("tab", { name: "基本信息" }));
    fireEvent.change(screen.getByLabelText("更新说明（Markdown）"), { target: { value: "**新增功能**" } });
    await screen.findByText("新增功能", { selector: "strong" }); expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${path}/1.6.0`));
    expect(JSON.parse(writes()[0]![1]!.body as string)).toEqual({ version: "1.6.0", versionCode: 2, releaseType: "gray", segmentIds: [], packageInfo: { downloadUrl: "https://cdn.example.com/app.apk", downloadSizeBytes: 1000, sha256: "a".repeat(64) }, releaseNotes: "**新增功能**" });
    await waitFor(() => expect((screen.getByLabelText("版本号") as HTMLInputElement).readOnly).toBe(true));
  });
  it("retains metadata edits and requires explicit revision adoption after a conflict", async () => {
    conflict = true; const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    fireEvent.change(await screen.findByLabelText("更新说明（Markdown）"), { target: { value: "我的说明" } });
    await user.click(screen.getByRole("button", { name: "保存版本" })); await screen.findByRole("button", { name: "保留我的编辑，采用最新修订号" });
    expect((screen.getByLabelText("更新说明（Markdown）") as HTMLTextAreaElement).value).toBe("我的说明");
    conflict = false; await user.click(screen.getByRole("button", { name: "保留我的编辑，采用最新修订号" })); await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(writes()).toHaveLength(2)); expect(JSON.parse(writes()[1]![1]!.body as string)).toMatchObject({ revision: 2, releaseNotes: "我的说明" });
  });
  it("keeps release notes, segments and package fields across tabs and saves them together", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    const notes = await screen.findByLabelText("更新说明（Markdown）") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "新增功能" } });
    notes.focus(); notes.setSelectionRange(0, 4);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    await screen.findByText("新增功能", { selector: "strong" });
    await chooseSegment(user);
    await user.click(screen.getByRole("radio", { name: "全量" }));
    expect(screen.queryByRole("checkbox", { name: /内测人群/ })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "灰度" }));
    expect(await screen.findByRole("button", { name: "移除人群 内测人群" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    expect(screen.queryByLabelText("版本号")).toBeNull();
    fireEvent.change(screen.getByLabelText("下载地址"), { target: { value: "https://cdn.example.com/new.apk" } });
    fireEvent.change(screen.getByLabelText("SHA-256"), { target: { value: "a".repeat(64) } });
    fireEvent.change(screen.getByLabelText("文件大小（字节）"), { target: { value: "1024" } });
    await user.click(screen.getByRole("tab", { name: "基本信息" }));
    expect((screen.getByLabelText("更新说明（Markdown）") as HTMLTextAreaElement).value).toBe("**新增功能**");
    expect(await screen.findByRole("button", { name: "移除人群 内测人群" })).toBeTruthy();
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]![0]).toBe(`${base}/1.4.1`);
    expect(JSON.parse(writes()[0]![1]!.body as string)).toMatchObject({ revision: 1, releaseNotes: "**新增功能**", releaseType: "gray", segmentIds: [segmentId], packageInfo: { downloadUrl: "https://cdn.example.com/new.apk", downloadSizeBytes: 1024, sha256: "a".repeat(64) } });
  });
  it("creates a gray version with segment selection in one request", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/new`);
    fireEvent.change(await screen.findByLabelText("版本号"), { target: { value: "1.6.0" } });
    fireEvent.change(screen.getByLabelText("versionCode"), { target: { value: "2" } });
    await chooseSegment(user);
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(items.find((item) => item.version === "1.6.0")?.segmentIds).toEqual([segmentId]));
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0]![1]!.body as string)).toMatchObject({ version: "1.6.0", versionCode: 2, releaseType: "gray", segmentIds: [segmentId] });
  });
  it("opens the tab containing invalid fields without losing the other tab's input", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/new`);
    await screen.findByLabelText("版本号");
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    fireEvent.change(screen.getByLabelText("下载地址"), { target: { value: "https://cdn.example.com/app.apk" } });
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await screen.findByLabelText("版本号");
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("版本号"), { target: { value: "1.6.0" } });
    fireEvent.change(screen.getByLabelText("versionCode"), { target: { value: "2" } });
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    expect((screen.getByLabelText("下载地址") as HTMLInputElement).value).toBe("https://cdn.example.com/app.apk");
    fireEvent.change(screen.getByLabelText("SHA-256"), { target: { value: "a".repeat(64) } });
    fireEvent.change(screen.getByLabelText("文件大小（字节）"), { target: { value: "0" } });
    await user.click(screen.getByRole("tab", { name: "基本信息" }));
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await screen.findByLabelText("文件大小（字节）");
    expect(writes()).toHaveLength(0);
  });
  it("changes gray to full and clears segment references on save", async () => {
    items[0]!.segmentIds = [segmentId]; const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    await user.click(await screen.findByRole("radio", { name: "全量" }));
    await screen.findByText("保存后将解除此版本的全部人群关联。");
    expect(writes()).toHaveLength(0); expect(items[0]!.segmentIds).toEqual([segmentId]);
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(items[0]).toMatchObject({ releaseType: "full", segmentIds: [], revision: 2 }));
    expect(JSON.parse(writes()[0]![1]!.body as string)).toMatchObject({ releaseType: "full", revision: 1 });
    await waitFor(() => expect(screen.queryByText("保存后将解除此版本的全部人群关联。")).toBeNull());
  });
  it("disables gray for the latest full version", async () => {
    items[0]!.releaseType = "full"; latestVersion = "1.4.1"; renderAdmin(`${path}/1.4.1`);
    await waitFor(() => expect((screen.getByRole("radio", { name: "灰度" }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole("radio", { name: "全量" }) as HTMLInputElement).checked).toBe(true);
  });
  it("only shows the version list without settings or rollout controls", async () => {
    latestVersion = "1.4.1"; items[0]!.releaseType = "full";
    renderAdmin(path);
    await screen.findByRole("link", { name: "1.4.1" });
    expect(screen.getByText("最新", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText(/最新全量版本/)).toBeNull();
    expect(screen.queryByRole("button", { name: "清空设置" })).toBeNull();
    expect(screen.queryByRole("group", { name: "版本管理视图" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "灰度配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "配置人群" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/admin/segments"))).toBe(false);
  });
  it("sets latest from the editor header and protects latest and referenced versions in the list", async () => {
    items[0]!.releaseType = "full"; items[1]!.segmentIds = [segmentId]; const user = userEvent.setup(); renderAdmin(path);
    await screen.findByRole("link", { name: "1.4.1" });
    expect(screen.queryByRole("button", { name: "设为最新" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "1.4.1" }));
    const button = await screen.findByRole("button", { name: "设为最新" });
    expect(screen.getByRole("heading", { name: "版本 1.4.1" }).parentElement?.contains(button)).toBe(true);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button); await user.click(screen.getByRole("button", { name: "确认" }));
    await screen.findByRole("button", { name: "已是最新" }); expect(latestVersion).toBe("1.4.1");
    expect(JSON.parse(writes()[0]![1]!.body as string)).toEqual({ revision: 1, version: "1.4.1" });
    await user.click(screen.getByRole("link", { name: "返回列表" }));
    await screen.findByText("最新", { selector: "span" });
    expect(screen.queryByRole("button", { name: "设为最新" })).toBeNull();
    expect((within(screen.getByRole("link", { name: "1.4.1" }).closest("tr")!).getByRole("button", { name: "删除" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(screen.getByRole("link", { name: "1.5.0" }).closest("tr")!).getByRole("button", { name: "删除" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "清空设置" })).toBeNull();
    expect(writes()).toHaveLength(1);
  });
  it("requires saving the full release type and any edits before setting latest", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    expect((await screen.findByRole("button", { name: "设为最新" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "全量" }));
    expect((screen.getByRole("button", { name: "设为最新" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "设为最新" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("更新说明（Markdown）"), { target: { value: "未保存修改" } });
    expect((screen.getByRole("button", { name: "设为最新" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(1); expect(latestVersion).toBeNull();
  });
  it("keeps editor input on latest-setting conflict and requires an explicit refresh before retrying", async () => {
    items[0]!.releaseType = "full";
    const original = vi.mocked(fetch).getMockImplementation()!; let rejectLatest = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input) === `${base}/latest` && init?.method === "PUT" && rejectLatest) { revision = 2; return Promise.resolve(fail(409, "最新版本设置已变化")); }
      return original(input, init);
    });
    const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    const button = await screen.findByRole("button", { name: "设为最新" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button); await user.click(screen.getByRole("button", { name: "确认" }));
    await screen.findByText("最新版本设置已变化");
    expect(writes()).toHaveLength(1); expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("更新说明（Markdown）") as HTMLTextAreaElement).value).toBe(initial.releaseNotes);
    rejectLatest = false; await user.click(screen.getByRole("button", { name: "刷新后重新操作" }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button); await user.click(screen.getByRole("button", { name: "确认" }));
    await screen.findByRole("button", { name: "已是最新" });
    expect(JSON.parse(writes()[1]![1]!.body as string)).toEqual({ revision: 2, version: "1.4.1" });
  });
  it("saves and clears segment references in the editor", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    await chooseSegment(user);
    expect(screen.queryByLabelText("sso_id 名单")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(items[0]!.segmentIds).toEqual([segmentId]));
    expect(writes()[0]![0]).toBe(`${base}/1.4.1`); expect(JSON.parse(writes()[0]![1]!.body as string)).toMatchObject({ revision: 1, segmentIds: [segmentId] });
    await waitFor(() => expect((screen.getByRole("button", { name: "保存版本" }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: "移除人群 内测人群" })); await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(items[0]!.segmentIds).toEqual([]));
  });
  it("keeps selected segments after an editor conflict", async () => {
    conflict = true; const user = userEvent.setup(); renderAdmin(`${path}/1.4.1`);
    await chooseSegment(user); await user.click(screen.getByRole("button", { name: "保存版本" }));
    await screen.findByRole("button", { name: "保留我的编辑，采用最新修订号" });
    expect(await screen.findByRole("button", { name: "移除人群 内测人群" })).toBeTruthy();
    conflict = false; await user.click(screen.getByRole("button", { name: "保留我的编辑，采用最新修订号" })); await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(writes()).toHaveLength(2)); expect(JSON.parse(writes()[1]![1]!.body as string)).toMatchObject({ revision: 2, segmentIds: [segmentId] });
  });
});
