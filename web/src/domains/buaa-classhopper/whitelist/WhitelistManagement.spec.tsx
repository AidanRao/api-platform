import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAdmin, ok, fail } from "../../../test-utils";
import type { PolicyConfig } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";

const policyPath = "/api/admin/buaa-classhopper/v1/iclass/access-policy", id = "SEGM-20261024-AAAAAAAAAA";
const segment = { id, name: "共享人群", revision: 1, members: { student_name: ["张三"], student_id: ["01"], sso_id: ["user-1"] }, counts: { student_name: 1, student_id: 1, sso_id: 1 }, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };
let config: PolicyConfig, conflict: boolean, unavailable: boolean;
beforeEach(() => {
  config = { revision: 1, segmentIds: [] }; conflict = false; unavailable = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "https://test.invalid");
    if (url.pathname === policyPath) {
      if (init?.method === "PUT") { if (conflict) { config.revision++; return fail(409, "配置已变化"); } config = { ...JSON.parse(init.body as string), revision: config.revision + 1 }; }
      return ok(config);
    }
    if (url.pathname === `/api/admin/segments/${id}`) return unavailable ? fail(503, "人群名单暂时不可用") : ok(segment);
    if (url.pathname === "/api/admin/segments") return ok({ items: [segment], total: 1, page: 1, pageSize: 20 });
    throw new Error(`Unexpected ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
describe("whitelist segment configuration", () => {
  it("shows all segment choices without pagination and filters them locally", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (new URL(String(input), "https://test.invalid").pathname === "/api/admin/segments") {
        return Promise.resolve(ok({ items: Array.from({ length: 25 }, (_, i) => ({ ...segment, id: `SEGM-20261024-${String(i).padStart(10, "0")}`, name: `人群 ${i + 1}` })), total: 25, page: 1, pageSize: 100 }));
      }
      return original(input, init);
    });
    const user = userEvent.setup(); renderAdmin();
    await screen.findByRole("checkbox", { name: /人群 25/ });
    expect(screen.getAllByRole("checkbox")).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
    await user.type(screen.getByLabelText("搜索人群"), "人群 25");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/admin/segments?"))).toHaveLength(1);
  });
  it("selects shared segments and previews members while saving only references", async () => {
    const user = userEvent.setup(); renderAdmin();
    await user.click(await screen.findByRole("checkbox", { name: /共享人群/ }));
    await screen.findByText("姓名（1）");
    expect(screen.queryByText("SSO ID（1）")).toBeNull(); expect(screen.queryByText("user-1")).toBeNull();
    expect(screen.queryByLabelText("新增姓名")).toBeNull(); expect(screen.queryByLabelText("新增学号")).toBeNull();
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(config.segmentIds).toEqual([id]));
    expect(writes()[0]![0]).toBe(policyPath); expect(writes()[0]![1]!.method).toBe("PUT"); expect(JSON.parse(writes()[0]![1]!.body as string)).toEqual({ revision: 1, segmentIds: [id] });
    expect(new Headers(vi.mocked(fetch).mock.calls[0]![1]?.headers).has("X-App-Version")).toBe(false);
  });
  it("preserves choices on conflict and requires explicit adoption", async () => {
    conflict = true; const user = userEvent.setup(); renderAdmin();
    await user.click(await screen.findByRole("checkbox", { name: /共享人群/ })); await user.click(screen.getByRole("button", { name: "保存配置" }));
    await screen.findByRole("button", { name: "保留选择，采用最新修订号" }); expect(screen.getByRole("checkbox", { name: /共享人群/ }).getAttribute("data-state")).toBe("checked");
    conflict = false; await user.click(screen.getByRole("button", { name: "保留选择，采用最新修订号" })); await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(writes()).toHaveLength(2)); expect(JSON.parse(writes()[1]![1]!.body as string).revision).toBe(2);
  });
  it("shows unavailable previews as errors and can remove a broken reference", async () => {
    config.segmentIds = [id]; unavailable = true; const user = userEvent.setup(); renderAdmin();
    await screen.findByText("人群名单暂时不可用"); await user.click(await screen.findByRole("button", { name: "移除人群 共享人群" }));
    await screen.findByText("姓名（0）"); await user.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(config.segmentIds).toEqual([]));
  });
});
