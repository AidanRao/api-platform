import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import type { Announcement } from "../../../../src/features/announcements/schema";
import { renderAdmin, ok, fail } from "../../test-utils";
import { resourceKey } from "../../platform/query";
const base = "/api/admin/buaa-classhopper/announcement";
const path = "/admin/buaa-classhopper/announcements";
const item: Announcement = { id: "one", title: "原始公告", content: "原始内容", coverUrl: null, isPinned: false, status: "draft", revision: 1, publishedAt: null, createdAt: "2026-09-22T08:00:00.000Z", updatedAt: "2026-09-22T08:00:00.000Z" };
let current: Announcement;
let conflict: boolean;
let uploadFails: boolean;
let deleted: boolean;
beforeEach(() => {
  current = { ...item }; conflict = false; uploadFails = false; deleted = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/admin/media/images") return uploadFails ? fail(502, "图片上传失败，请稍后重试") : ok({ url: "https://images.example.com/a.png" });
    if (input === base && init?.method === "POST") { current = { ...item, ...JSON.parse(init.body as string) }; return ok(current); }
    if (input === `${base}/one` && init?.method === "PATCH") {
      if (conflict) { current = { ...item, title: "服务器标题", revision: 2 }; return fail(409, "公告已被其他管理员修改，请检查最新版本"); }
      current = { ...current, ...JSON.parse(init.body as string), revision: current.revision + 1 }; return ok(current);
    }
    if (input === `${base}/one` && init?.method === "DELETE") { deleted = true; return ok(null); }
    if (input.endsWith("/publish") || input.endsWith("/unpublish")) { current = { ...current, status: input.endsWith("/unpublish") ? "unpublished" : "published", revision: current.revision + 1, publishedAt: item.createdAt }; return ok(current); }
    if (input === `${base}/one`) return ok(current);
    if (input.includes("announcement?")) {
      const params = new URL(input, "https://test.invalid").searchParams;
      return ok({ items: deleted ? [] : [current], page: Number(params.get("page")), pageSize: 20, total: deleted ? 0 : 21 });
    }
    throw new Error(`Unexpected request ${input}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method && init.method !== "GET");

describe("routed announcement management", () => {
  it("creates then publishes with revision and changes the new route to a stable detail URL", async () => {
    const user = userEvent.setup(); const { router } = renderAdmin(`${path}/new`);
    await user.type(await screen.findByLabelText("公告标题"), item.title);
    await user.type(screen.getByLabelText("公告内容（Markdown）"), item.content);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("heading", { name: "编辑公告" });
    expect(router.state.location.pathname).toBe(`${path}/one`);
    expect(JSON.parse(writes()[0]?.[1]?.body as string)).toEqual({ title: item.title, content: item.content, isPinned: false, coverUrl: null });
    await user.click(screen.getByRole("button", { name: "发布" })); await screen.findByText("公告已发布");
    expect(writes()[1]?.[0]).toBe(`${base}/one/publish`);
    expect(JSON.parse(writes()[1]?.[1]?.body as string)).toEqual({ revision: 1 });
  });
  it("retains edits on 409 and requires explicit review before adopting the latest revision", async () => {
    conflict = true;
    const user = userEvent.setup(); renderAdmin(`${path}/one`);
    fireEvent.change(await screen.findByLabelText("公告标题"), { target: { value: "我的标题" } });
    await user.click(screen.getByRole("button", { name: "保存公告" }));
    await screen.findByText("服务器标题");
    expect((screen.getByLabelText("公告标题") as HTMLInputElement).value).toBe("我的标题");
    expect((screen.getByRole("button", { name: "保存公告" }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(1);
    conflict = false;
    await user.click(screen.getByRole("button", { name: "保留我的编辑，采用最新版本号" }));
    await user.click(screen.getByRole("button", { name: "保存公告" })); await screen.findByText("公告已保存");
    expect(JSON.parse(writes()[1]?.[1]?.body as string)).toMatchObject({ revision: 2, title: "我的标题" });
  });
  it("keeps Markdown on upload failure and retries through the platform URL without app identity", async () => {
    uploadFails = true;
    const user = userEvent.setup(); renderAdmin(`${path}/one`);
    const textarea = await screen.findByLabelText("公告内容（Markdown）") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);
    const file = new File([new Uint8Array([137,80,78,71])], "image.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("上传图片"), file); await screen.findByText("图片上传失败，请稍后重试");
    expect(textarea.value).toBe(item.content);
    uploadFails = false;
    await user.upload(screen.getByLabelText("上传图片"), file); await screen.findByText("图片已插入，请保存公告");
    expect(textarea.value).toBe("![图片](<https://images.example.com/a.png>)原始内容");
    expect(writes()[1]?.[0]).toBe("/api/admin/media/images"); expect(writes()[1]?.[1]?.body).toBe(file);
  });
  it("uploads a cover separately from Markdown, retains it on failure and saves removal", async () => {
    const user = userEvent.setup(); renderAdmin(`${path}/one`);
    const input = await screen.findByLabelText("公告封面（可选）");
    const file = new File([new Uint8Array([137,80,78,71])], "cover.png", { type: "image/png" });
    await user.upload(input, file);
    await screen.findByText("封面已上传，请保存公告");
    expect(screen.getByRole("img", { name: "公告封面预览" }).getAttribute("src")).toBe("https://images.example.com/a.png");
    expect((screen.getByLabelText("公告内容（Markdown）") as HTMLTextAreaElement).value).toBe(item.content);
    uploadFails = true;
    await user.upload(input, file); await screen.findByText("图片上传失败，请稍后重试");
    expect(screen.getByRole("img", { name: "公告封面预览" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "保存公告" })); await screen.findByText("公告已保存");
    expect(current.coverUrl).toBe("https://images.example.com/a.png");
    await user.click(screen.getByRole("button", { name: "移除封面" }));
    await user.click(screen.getByRole("button", { name: "保存公告" }));
    await waitFor(() => expect(current.coverUrl).toBeNull());
    expect(screen.queryByRole("img", { name: "公告封面预览" })).toBeNull();
  });
  it("rejects non-image cover files before sending an upload", async () => {
    renderAdmin(`${path}/new`);
    const input = await screen.findByLabelText("公告封面（可选）");
    fireEvent.change(input, { target: { files: [new File(["video"], "video.mp4", { type: "video/mp4" })] } });
    expect(await screen.findByText("仅支持 JPEG、PNG、WebP、GIF 图片")).not.toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("stores pagination in the URL and preserves drafts through same-app navigation and history", async () => {
    const user = userEvent.setup(); const { router } = renderAdmin(`${path}?page=2&status=draft`);
    await user.click(await screen.findByRole("link", { name: item.title }));
    fireEvent.change(await screen.findByLabelText("公告标题"), { target: { value: "未保存" } });
    await act(() => router.navigate(-1));
    await screen.findByText("第 2 页 · 共 21 条");
    expect(router.state.location.search).toBe("?page=2&status=draft");
    await user.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByText("第 1 页 · 共 21 条");
    expect(router.state.location.search).toBe("?page=1&status=draft");
    await user.click(screen.getByRole("link", { name: item.title }));
    expect((await screen.findByLabelText("公告标题") as HTMLInputElement).value).toBe("未保存");
  });
  it("does not overwrite a draft on background query refresh and invalidates only its application", async () => {
    const user = userEvent.setup(); const { client } = renderAdmin(`${path}/one`);
    fireEvent.change(await screen.findByLabelText("公告标题"), { target: { value: "我的标题" } });
    client.setQueryData([...resourceKey("second-app", "announcements"), "list"], { sentinel: true });
    current = { ...item, title: "远程更改", revision: 2 };
    await act(() => client.invalidateQueries({ queryKey: resourceKey("buaa-classhopper", "announcements") }));
    expect((screen.getByLabelText("公告标题") as HTMLInputElement).value).toBe("我的标题");
    await user.click(screen.getByRole("button", { name: "保存公告" })); await screen.findByText("公告已保存");
    expect(JSON.parse(writes()[0]?.[1]?.body as string).revision).toBe(1);
    expect(client.getQueryState([...resourceKey("second-app", "announcements"), "list"])?.isInvalidated).toBe(false);
  });
  it("guards cross-app navigation, allows cancelling, discards only on confirmation, and guards unload", async () => {
    const user = userEvent.setup(); const { router } = renderAdmin(`${path}/new`);
    await user.type(await screen.findByLabelText("公告标题"), "未保存");
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await act(() => router.navigate("/admin/second-app/announcements"));
    await screen.findByRole("alertdialog"); await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(router.state.location.pathname).toBe(`${path}/new`);
    await act(() => router.navigate("/admin/second-app/announcements"));
    await user.click(await screen.findByRole("button", { name: "放弃更改并离开" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/second-app/announcements"));
    await act(() => router.navigate(`${path}/new`));
    expect((await screen.findByLabelText("公告标题") as HTMLInputElement).value).toBe("");
  });
  it("unpublishes and deletes with revision using a cancellable accessible confirmation", async () => {
    current = { ...item, status: "published", publishedAt: item.createdAt };
    const user = userEvent.setup(); renderAdmin(`${path}/one`);
    await user.click(await screen.findByRole("button", { name: "下架" })); await screen.findByText("公告已下架");
    await user.click(screen.getByRole("button", { name: "删除公告" }));
    await user.click(screen.getByRole("button", { name: "取消" })); expect(writes()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "删除公告" }));
    await user.click(screen.getByRole("button", { name: "确认删除" })); await screen.findByText("暂无公告");
    expect(writes()[1]?.[1]?.method).toBe("DELETE"); expect(JSON.parse(writes()[1]?.[1]?.body as string)).toEqual({ revision: 2 });
  });
});
describe("Markdown preview", () => {
  it("renders GFM and images without executing raw HTML or dangerous URL schemes", async () => {
    const { container } = render(<MarkdownPreview content={'# 标题\n\n~~删除线~~\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29)\n\n![图片](https://images.example.com/a.png)'} />);
    expect(screen.getByRole("heading", { name: "标题" })).not.toBeNull();
    expect(container.querySelector("del")?.textContent).toBe("删除线");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull(); expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole("img", { name: "图片" }).getAttribute("src")).toBe("https://images.example.com/a.png");
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(1));
  });
});
