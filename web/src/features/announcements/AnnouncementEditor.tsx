import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Link, useNavigate, useParams } from "react-router";
import { createSchema, type Announcement, type CreateAnnouncement } from "../../../../src/features/announcements/schema";
import { useApplication } from "../../platform/AppContext";
import { useDraft } from "../../platform/drafts";
import { resourceKey } from "../../platform/query";
import { uploadImage } from "../../platform/media";
import { AdminApiError } from "../../platform/api";
import { ErrorNotice, Loading, Notice } from "../../platform/feedback";
import { createAnnouncementClient } from "./api";
import { MarkdownPreview } from "./MarkdownPreview";
import { statusNames, formatTime } from "./presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

const emptyDraft = (): CreateAnnouncement => ({ title: "", content: "", isPinned: false, coverUrl: null });
const fields = (item: Announcement): CreateAnnouncement => ({ title: item.title, content: item.content, isPinned: item.isPinned, coverUrl: item.coverUrl });
type Session = { saved: Announcement | null; draft: CreateAnnouncement; conflict: boolean; latest: Announcement | null };
const dirty = (session: Session) => JSON.stringify(session.draft) !== JSON.stringify(session.saved ? fields(session.saved) : emptyDraft());

export default function AnnouncementEditor() {
  const app = useApplication();
  const { id } = useParams();
  const api = useMemo(() => createAnnouncementClient(app.id), [app.id]);
  const detail = useQuery({ queryKey: [...resourceKey(app.id, "announcements"), "detail", id], queryFn: () => api.get(id!), enabled: Boolean(id) });
  if (id && detail.isPending) return <Loading />;
  if (id && detail.isError) return <><ErrorNotice error={detail.error} /><Button onClick={() => void detail.refetch()}>重新加载</Button></>;
  return <Editor key={`${app.id}/${id ?? "new"}`} initial={detail.data ?? null} id={id ?? "new"} />;
}
function Editor({ initial, id }: { initial: Announcement | null; id: string }) {
  const app = useApplication();
  const api = useMemo(() => createAnnouncementClient(app.id), [app.id]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const path = `/admin/${app.id}/announcements`;
  const [session, setSession, removeSession] = useDraft<Session>(app.id, "announcements", id, () => ({ saved: initial, draft: initial ? fields(initial) : emptyDraft(), conflict: false, latest: null }), dirty);
  const form = useForm<z.input<typeof createSchema>, unknown, CreateAnnouncement>({ resolver: zodResolver(createSchema), defaultValues: session.draft });
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const contentRegistration = form.register("content");
  const preview = useDeferredValue(form.watch("content") ?? "");
  const saved = session.saved;
  const changed = dirty(session);
  useEffect(() => {
    const subscription = form.watch((value) => setSession((previous) => ({ ...previous, draft: { title: value.title ?? "", content: value.content ?? "", isPinned: value.isPinned ?? false, coverUrl: value.coverUrl ?? null } })));
    return () => subscription.unsubscribe();
    // The draft key and form instance are fixed for this mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  const mutation = useMutation({ mutationFn: async (operation: () => Promise<void>) => {
    setSession((previous) => previous, true); setError(null); setNotice(null);
    try { await operation(); }
    catch (caught) {
      setError(caught);
      if (caught instanceof AdminApiError && caught.status === 409 && saved) {
        setSession((previous) => ({ ...previous, conflict: true }));
        try { const latest = await api.get(saved.id); setSession((previous) => ({ ...previous, latest })); } catch { /* Retain draft if latest fetch also fails. */ }
      }
    } finally { setSession((previous) => previous); }
  } });
  const busy = mutation.isPending;
  function accept(value: Announcement) {
    form.reset(fields(value));
    setSession({ saved: value, draft: fields(value), conflict: false, latest: null });
    queryClient.setQueryData([...resourceKey(app.id, "announcements"), "detail", value.id], value);
    void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "announcements") });
  }
  const save = form.handleSubmit((value) => mutation.mutate(async () => {
    const updated = saved ? await api.patch(saved.id, { ...value, revision: saved.revision }) : await api.create(value);
    accept(updated);
    setNotice(saved?.status === "published" ? "公告已保存，修改已公开生效" : "公告已保存");
    if (!saved) { removeSession(); navigate(`${path}/${updated.id}`, { replace: true }); }
  }));
  function upload(file: File, target: "content" | "cover" = "content") {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setError(new Error("仅支持 JPEG、PNG、WebP、GIF 图片")); return; }
    if (file.size > 5 * 1024 * 1024) { setError(new Error("图片不能超过 5 MiB")); return; }
    const content = form.getValues("content") ?? "";
    const start = textarea.current?.selectionStart ?? content.length;
    const end = textarea.current?.selectionEnd ?? start;
    mutation.mutate(async () => {
      const { url } = await uploadImage(file);
      if (target === "cover") {
        form.setValue("coverUrl", url, { shouldDirty: true, shouldValidate: true });
        setNotice("封面已上传，请保存公告");
        return;
      }
      form.setValue("content", `${content.slice(0, start)}![图片](<${url}>)${content.slice(end)}`, { shouldDirty: true, shouldValidate: true });
      setNotice("图片已插入，请保存公告");
    });
  }
  return <div className="space-y-6">
    <Button asChild variant="ghost" className="-ml-3"><Link to={path}>← 返回公告列表</Link></Button>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{saved ? "编辑公告" : "新增草稿"}</h1><p className="text-sm text-muted-foreground">{saved ? `${statusNames[saved.status]} · ${formatTime(saved.publishedAt)}（上海时间）` : "保存为草稿后可发布"}</p></header>
    <ErrorNotice error={error} /><Notice>{notice}</Notice>
    {session.conflict && <Card><CardHeader><CardTitle>版本冲突，编辑内容已保留</CardTitle></CardHeader><CardContent className="space-y-4">
      {session.latest ? <><details><summary className="cursor-pointer">查看最新版本（版本 {session.latest.revision}）</summary><h3 className="my-3 font-medium">{session.latest.title}</h3>{session.latest.coverUrl ? <img src={session.latest.coverUrl} alt="服务器最新封面" className="max-h-40 max-w-full object-contain" /> : <p>无封面</p>}<p>{statusNames[session.latest.status]} · {session.latest.isPinned ? "置顶" : "未置顶"}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{session.latest.content}</pre></details>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { setSession((previous) => ({ ...previous, saved: previous.latest, conflict: false, latest: null })); setError(null); setNotice("已采用最新版本号，请检查当前编辑内容后保存"); }}>保留我的编辑，采用最新版本号</Button>
      <Button variant="outline" disabled={busy} onClick={() => { accept(session.latest!); setError(null); }}>放弃我的编辑，加载最新内容</Button></div></> : <Button disabled={busy} onClick={() => mutation.mutate(async () => { const latest = await api.get(saved!.id); setSession((previous) => ({ ...previous, latest })); })}>获取最新版本</Button>}
    </CardContent></Card>}
    <form onSubmit={save} className="space-y-6" noValidate>
      <fieldset disabled={busy} className="space-y-6">
        <div className="space-y-2"><Label htmlFor="announcement-title">公告标题</Label><Input id="announcement-title" maxLength={200} {...form.register("title")} aria-invalid={!!form.formState.errors.title} aria-describedby="title-error" /><p id="title-error" role="alert" className="text-sm text-destructive">{form.formState.errors.title?.message}</p></div>
        <div className="flex items-center gap-2"><Checkbox id="pin" checked={form.watch("isPinned") ?? false} disabled={busy} onCheckedChange={(value) => form.setValue("isPinned", value === true, { shouldDirty: true })} /><Label htmlFor="pin">置顶公告</Label></div>
        <div className="space-y-3">
          <Label htmlFor="cover-upload">公告封面（可选）</Label>
          {form.watch("coverUrl") && <div className="space-y-2"><img src={form.watch("coverUrl")!} alt="公告封面预览" className="max-h-56 max-w-full rounded-md border object-contain" /><Button type="button" variant="outline" onClick={() => form.setValue("coverUrl", null, { shouldDirty: true, shouldValidate: true })}>移除封面</Button></div>}
          <Input id="cover-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-describedby="cover-hint cover-error" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file, "cover"); }} />
          <p id="cover-hint" className="text-sm text-muted-foreground">支持 JPEG、PNG、WebP、GIF，最大 5 MiB。</p>
          <p id="cover-error" role="alert" className="text-sm text-destructive">{form.formState.errors.coverUrl?.message}</p>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3"><Label htmlFor="announcement-content">公告内容（Markdown）</Label><Textarea id="announcement-content" className="min-h-96 font-mono text-sm" {...contentRegistration} ref={(element) => { contentRegistration.ref(element); textarea.current = element; }} aria-invalid={!!form.formState.errors.content} aria-describedby="content-error" /><p id="content-error" role="alert" className="text-sm text-destructive">{form.formState.errors.content?.message}</p>
            <Label htmlFor="image-upload">上传图片</Label><Input id="image-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} /></div>
          <Card className="min-w-0"><CardHeader><CardTitle>Markdown 预览</CardTitle></CardHeader><CardContent><MarkdownPreview content={preview} /></CardContent></Card>
        </div>
      </fieldset>
      {saved?.status === "published" && <p className="text-sm text-muted-foreground">保存后，修改会立即对外公开。</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || session.conflict || (!!saved && !changed)}>{busy ? "处理中…" : saved ? "保存公告" : "保存草稿"}</Button>
        {saved && <><Button type="button" variant="outline" disabled={busy || session.conflict || changed} onClick={() => mutation.mutate(async () => { accept(await api.changeStatus(saved.id, saved.revision, saved.status === "published" ? "unpublish" : "publish")); setNotice(saved.status === "published" ? "公告已下架" : "公告已发布"); })}>{saved.status === "published" ? "下架" : "发布"}</Button>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" type="button" disabled={busy || session.conflict}>删除公告</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除公告“{saved.title}”？</AlertDialogTitle><AlertDialogDescription>此操作不可恢复。正文引用的图片将保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => mutation.mutate(async () => { await api.delete(saved.id, saved.revision); removeSession(); void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "announcements") }); navigate(path); })}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>}
      </div>{changed && saved && <p className="text-sm text-muted-foreground">请先保存更改，再发布或下架。</p>}
    </form>
  </div>;
}
