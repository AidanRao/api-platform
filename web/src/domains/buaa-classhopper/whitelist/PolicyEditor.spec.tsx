import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPolicyConfig, type PolicyConfig } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import type { AppVersion } from "../../../../../src/features/versions/schema";
import { fail, ok, renderAdmin } from "../../../test-utils";

const path = "/admin/buaa-classhopper/versions", api = "/api/admin/buaa-classhopper/versions";
const policyApi = "/api/admin/buaa-classhopper/v1/iclass/access-policy";
const segmentId = "SEGM-20261024-AAAAAAAAAA", otherId = "SEGM-20261024-BBBBBBBBBB";
const initial: AppVersion = { version: "1.5.1", versionCode: 2, releaseType: "gray", segmentIds: [], releaseNotes: "原说明", packageInfo: null,
  revision: 1, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };
let config: PolicyConfig, versions: AppVersion[], unavailable: boolean;
beforeEach(() => {
  config = emptyPolicyConfig(); versions = [structuredClone(initial)]; unavailable = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "https://test.invalid"), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url.pathname === policyApi) {
      if (unavailable) return fail(503, "白名单配置暂时不可用");
      if (method === "PUT") {
        if (body.revision !== config.revision) return fail(409, "配置已变化");
        config = { ...body, revision: config.revision + 1 };
      }
      return ok(config);
    }
    if (url.pathname.endsWith("/versions/latest")) return ok({ latestVersion: null, revision: 1 });
    if (url.pathname.endsWith("/versions")) {
      if (method === "POST") { const version = { ...initial, ...body }; versions.push(version); return ok(version); }
      return ok({ items: versions, total: versions.length, page: 1, pageSize: 20 });
    }
    if (url.pathname.includes("/versions/")) {
      const item = versions.find((v) => url.pathname.endsWith(`/${v.version}`));
      if (!item) return fail(404, "版本不存在");
      if (method === "PATCH") Object.assign(item, body, { revision: item.revision + 1 });
      if (method === "DELETE") { versions = versions.filter((v) => v !== item); return ok(null); }
      return ok(item);
    }
    const segments = [segmentId, otherId].map((id, index) => ({ id, name: index ? "其他人群" : "白名单人群", revision: 1, counts: { student_name: 1, student_id: 1, sso_id: 1 }, createdAt: initial.createdAt, updatedAt: initial.updatedAt }));
    if (url.pathname === "/api/admin/segments") return ok({ items: segments, total: 2, page: 1, pageSize: 100 });
    const segment = segments.find((s) => url.pathname === `/api/admin/segments/${s.id}`);
    if (segment) return ok({ ...segment, members: { student_name: ["张三"], student_id: ["20260001"], sso_id: ["private-sso"] } });
    throw new Error(`Unexpected request: ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
async function openWhitelist(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "白名单" }));
  return within(await screen.findByRole("form", { name: "版本白名单配置" }));
}
async function openDefaults(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "默认策略" }));
  return within(await screen.findByRole("form", { name: "默认策略配置" }));
}
async function chooseSegment(user: ReturnType<typeof userEvent.setup>, scope = within(document.body), name = "白名单人群") {
  await user.click(scope.getByRole("button", { name: "添加人群" }));
  const picker = within(await screen.findByRole("dialog", { name: "选择人群" }));
  await user.click(await picker.findByRole("checkbox", { name: new RegExp(name) }));
  await user.click(picker.getByRole("button", { name: "完成" }));
}

describe("whitelist in version management", () => {
  it("redirects the legacy page and uses versions as the BUAA landing page", async () => {
    const { router } = renderAdmin("/admin/buaa-classhopper/whitelist");
    await screen.findByRole("heading", { name: "版本管理" });
    expect(router.state.location.pathname).toBe(path);
    expect(screen.queryByRole("link", { name: "白名单管理" })).toBeNull();
    expect(screen.queryByRole("button", { name: "默认策略" })).toBeNull();
    await act(() => router.navigate("/admin/buaa-classhopper/"));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
  });

  it("finds the exact version and shows only segment selection in its whitelist tab", async () => {
    config.rules = [{ version: "1.5.1", segmentIds: [segmentId] }, { version: "1.5.10", segmentIds: [otherId] }];
    const user = userEvent.setup(); renderAdmin(path);
    const row = within((await screen.findByRole("link", { name: "1.5.1" })).closest("tr")!);
    expect(screen.getByRole("columnheader", { name: "灰度人群" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "白名单" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("access-policy"))).toBe(false);
    await user.click(row.getByRole("link", { name: "1.5.1" }));
    const editor = await openWhitelist(user);
    expect(await editor.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    expect(editor.queryByRole("button", { name: "移除人群 其他人群" })).toBeNull();
    expect(editor.queryAllByRole("radio")).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  it("leaves an unmatched version empty without creating a rule", async () => {
    config.rules = [{ version: "1.5.10", segmentIds: [otherId] }];
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    expect(screen.queryByRole("button", { name: "默认策略" })).toBeNull();
    const editor = await openWhitelist(user);
    expect(editor.getByRole("button", { name: "添加人群" })).toBeTruthy();
    expect(editor.queryAllByRole("radio")).toHaveLength(0);
    expect((editor.getByRole("button", { name: "保存白名单" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it("adds whitelist segments independently of gray segments, including full releases", async () => {
    versions[0]!.releaseType = "full";
    config.rules = [{ version: "0.1.0", segmentIds: [otherId] }];
    config.default.invalidVersion = { type: "unavailable" };
    const before = structuredClone(config), user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    const editor = await openWhitelist(user);
    await chooseSegment(user, editor);
    await editor.findByText("张三");
    expect(editor.getByText("20260001")).toBeTruthy(); expect(editor.queryByText("private-sso")).toBeNull();
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.rules).toEqual([...before.rules, { version: "1.5.1", segmentIds: [segmentId] }]));
    expect(config.default).toEqual(before.default);
    expect(versions[0]).toMatchObject({ releaseType: "full", segmentIds: [], revision: 1 });
    expect(writes()).toHaveLength(1); expect(writes()[0]![0]).toBe(policyApi);
  });

  it("removes only this version rule after removing its last segment", async () => {
    config.rules = [{ version: "1.5.1", segmentIds: [segmentId] }, { version: "0.1.0", segmentIds: [otherId] }];
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    const editor = await openWhitelist(user);
    await user.click(await editor.findByRole("button", { name: "移除人群 白名单人群" }));
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.rules).toEqual([{ version: "0.1.0", segmentIds: [otherId] }]));
  });

  it("keeps separate drafts across tabs and saves only the active form", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    fireEvent.change(await screen.findByLabelText("更新说明（Markdown）"), { target: { value: "未保存说明" } });
    let editor = await openWhitelist(user);
    await chooseSegment(user, editor);
    await user.click(screen.getByRole("tab", { name: "安装包" }));
    await user.click(screen.getByRole("tab", { name: "基本信息" }));
    expect((screen.getByLabelText("更新说明（Markdown）") as HTMLTextAreaElement).value).toBe("未保存说明");
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(versions[0]!.releaseNotes).toBe("未保存说明")); expect(config.revision).toBe(1);
    editor = await openWhitelist(user);
    expect(await editor.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.revision).toBe(2));
    expect(writes().map(([url]) => url)).toEqual([`${api}/1.5.1`, policyApi]);
  });

  it("requires saving a new version before configuring its whitelist", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/new`);
    expect((await screen.findByRole("tab", { name: "白名单" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("版本号"), { target: { value: "1.6.0" } });
    fireEvent.change(screen.getByLabelText("versionCode"), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect((screen.getByRole("tab", { name: "白名单" }) as HTMLButtonElement).disabled).toBe(false));
    const editor = await openWhitelist(user);
    expect(editor.getByRole("button", { name: "添加人群" })).toBeTruthy(); expect(writes()).toHaveLength(1);
  });

  it("edits defaults inline inside the whitelist tab without a parent dialog", async () => {
    config.rules = [{ version: "1.5.1", segmentIds: [segmentId] }];
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`); await openWhitelist(user);
    let defaults = await openDefaults(user);
    expect(screen.getByRole("tabpanel", { name: "白名单" }).contains(defaults.getByRole("region", { name: "版本未匹配" }))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(within(defaults.getByRole("region", { name: "版本未匹配" })).getByRole("radio", { name: "不可用" }));
    await user.click(within(defaults.getByRole("region", { name: "版本号缺失或无效" })).getByRole("radio", { name: "指定人群" }));
    await chooseSegment(user, defaults);
    await user.click(screen.getByRole("button", { name: "返回白名单" }));
    expect(await screen.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    defaults = await openDefaults(user);
    expect((within(defaults.getByRole("region", { name: "版本未匹配" })).getByRole("radio", { name: "不可用" }) as HTMLInputElement).checked).toBe(true);
    expect(await defaults.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    await user.click(defaults.getByRole("button", { name: "保存默认策略" }));
    await waitFor(() => expect(config.default).toEqual({ unmatched: { type: "unavailable" }, invalidVersion: { type: "segments", segmentIds: [segmentId] } }));
    expect(config.rules).toEqual([{ version: "1.5.1", segmentIds: [segmentId] }]);
  });

  it("can save an explicit empty result for both defaults", async () => {
    config.default = { unmatched: { type: "unavailable" }, invalidVersion: { type: "segments", segmentIds: [segmentId] } };
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`); await openWhitelist(user);
    const defaults = await openDefaults(user);
    for (const label of ["版本未匹配", "版本号缺失或无效"]) {
      await user.click(within(defaults.getByRole("region", { name: label })).getByRole("radio", { name: "返回空名单" }));
    }
    await user.click(defaults.getByRole("button", { name: "保存默认策略" }));
    await waitFor(() => expect(config.default).toEqual({ unmatched: { type: "empty" }, invalidVersion: { type: "empty" } }));
  });

  it("retains the whitelist draft while saving defaults, then requires an explicit conflict rebase", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    let editor = await openWhitelist(user); await chooseSegment(user, editor);
    const defaults = await openDefaults(user);
    await user.click(within(defaults.getByRole("region", { name: "版本未匹配" })).getByRole("radio", { name: "不可用" }));
    await user.click(defaults.getByRole("button", { name: "保存默认策略" }));
    await waitFor(() => expect(config.revision).toBe(2));
    await user.click(screen.getByRole("button", { name: "返回白名单" }));
    editor = within(await screen.findByRole("form", { name: "版本白名单配置" }));
    expect(await editor.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await user.click(await editor.findByRole("button", { name: "保留更改，采用最新修订号" }));
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.revision).toBe(3));
    expect(config.default.unmatched).toEqual({ type: "unavailable" });
    expect(config.rules).toEqual([{ version: "1.5.1", segmentIds: [segmentId] }]);
  });

  it("rebases only the current version after reviewing a conflict", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    const editor = await openWhitelist(user); await chooseSegment(user, editor);
    config = { revision: 2, rules: [{ version: "1.5.1", segmentIds: [otherId] }, { version: "9.0.0", segmentIds: [otherId] }], default: { unmatched: { type: "unavailable" }, invalidVersion: { type: "empty" } } };
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await editor.findByRole("button", { name: "保留更改，采用最新修订号" });
    expect((editor.getByRole("button", { name: "保存白名单" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(editor.getByRole("button", { name: "保留更改，采用最新修订号" }));
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.revision).toBe(3));
    expect(config.rules).toEqual([{ version: "1.5.1", segmentIds: [segmentId] }, { version: "9.0.0", segmentIds: [otherId] }]);
    expect(config.default.unmatched).toEqual({ type: "unavailable" });
  });

  it("preserves newer rules when retrying a default-policy conflict", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`); await openWhitelist(user);
    const defaults = await openDefaults(user);
    await user.click(within(defaults.getByRole("region", { name: "版本未匹配" })).getByRole("radio", { name: "不可用" }));
    config.revision = 2; config.rules = [{ version: "1.5.1", segmentIds: [otherId] }];
    await user.click(defaults.getByRole("button", { name: "保存默认策略" }));
    await user.click(await defaults.findByRole("button", { name: "保留更改，采用最新修订号" }));
    await user.click(defaults.getByRole("button", { name: "保存默认策略" }));
    await waitFor(() => expect(config.revision).toBe(3));
    expect(config.rules).toEqual([{ version: "1.5.1", segmentIds: [otherId] }]);
    expect(config.default.unmatched).toEqual({ type: "unavailable" });
  });

  it("can load the server configuration after a conflict", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    const editor = await openWhitelist(user); await chooseSegment(user, editor);
    config.revision = 2; config.rules = [{ version: "1.5.1", segmentIds: [otherId] }];
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await user.click(await editor.findByRole("button", { name: "加载服务器配置" }));
    expect(await editor.findByRole("button", { name: "移除人群 其他人群" })).toBeTruthy();
    expect(editor.queryByRole("button", { name: "移除人群 白名单人群" })).toBeNull();
    expect((editor.getByRole("button", { name: "保存白名单" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps in-flight saves disabled when switching between version and default editors", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === policyApi && init?.method === "PUT") await pending;
      return original(input, init);
    });
    const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    const editor = await openWhitelist(user); await chooseSegment(user, editor);
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    const defaults = await openDefaults(user);
    expect(within(defaults.getByRole("region", { name: "版本未匹配" })).getByRole("radio", { name: "不可用" }).matches(":disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "返回白名单" }));
    expect((screen.getByRole("button", { name: "保存中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "添加人群" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(); await pending; });
    await waitFor(() => expect(config.revision).toBe(2));
    await screen.findByRole("button", { name: "保存白名单" }); expect(writes()).toHaveLength(1);
  });

  it("preserves failed-save edits for retry and handles initial load failure", async () => {
    unavailable = true; const user = userEvent.setup(); renderAdmin(`${path}/1.5.1`);
    await user.click(await screen.findByRole("tab", { name: "白名单" }));
    await screen.findByText("白名单配置暂时不可用");
    expect(screen.queryByRole("button", { name: "添加人群" })).toBeNull();
    unavailable = false; await user.click(screen.getByRole("button", { name: "重新加载白名单" }));
    const editor = within(await screen.findByRole("form", { name: "版本白名单配置" }));
    await chooseSegment(user, editor); unavailable = true;
    await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await editor.findByText("白名单配置暂时不可用");
    expect(await editor.findByRole("button", { name: "移除人群 白名单人群" })).toBeTruthy();
    unavailable = false; await user.click(editor.getByRole("button", { name: "保存白名单" }));
    await waitFor(() => expect(config.rules).toEqual([{ version: "1.5.1", segmentIds: [segmentId] }]));
    expect(writes()).toHaveLength(2);
  });

  it("retains whitelist rules when deleting version metadata", async () => {
    config.rules = [{ version: "1.5.1", segmentIds: [segmentId] }];
    const user = userEvent.setup(); renderAdmin(path);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(versions).toHaveLength(0));
    expect(config.rules).toHaveLength(1); expect(writes()).toHaveLength(1); expect(writes()[0]![1]!.method).toBe("DELETE");
  });

  it("does not show or request whitelist functionality for other apps", async () => {
    const user = userEvent.setup(), { router } = renderAdmin("/admin/second-app/versions");
    await screen.findByRole("link", { name: "1.5.1" });
    expect(screen.queryByRole("button", { name: "默认策略" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "白名单" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "1.5.1" })); await screen.findByLabelText("版本号");
    expect(screen.queryByRole("tab", { name: "白名单" })).toBeNull();
    await act(() => router.navigate("/admin/second-app/whitelist"));
    await screen.findByRole("heading", { name: "页面或应用不存在" });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("access-policy"))).toBe(false);
  });
});
