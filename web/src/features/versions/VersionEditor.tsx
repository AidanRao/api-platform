import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { createVersionSchema, type AppVersion } from "../../../../src/features/versions/schema";
import { useApplication } from "../../platform/AppContext";
import { useDraft } from "../../platform/drafts";
import { resourceKey } from "../../platform/query";
import { AdminApiError } from "../../platform/api";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { Tabs } from "radix-ui";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { SegmentPicker } from "../segments/SegmentPicker";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { Button } from "@/components/ui/button";
import { EditorActions } from "@/components/ui/editor-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { createVersionClient } from "./api";
import { VersionWhitelist } from "../../domains/buaa-classhopper/whitelist/PolicyEditor";
import "../../platform/resource-theme.css";

type Draft = { version: string; releaseType: AppVersion["releaseType"]; segmentIds: string[]; releaseNotes: string; downloadUrl: string; size: string; versionCode: string; sha256: string };
const empty: Draft = { version: "", releaseType: "gray", segmentIds: [], releaseNotes: "", downloadUrl: "", size: "", versionCode: "", sha256: "" };
const fields = (v: AppVersion): Draft => ({ version: v.version, releaseType: v.releaseType, segmentIds: v.segmentIds, releaseNotes: v.releaseNotes, downloadUrl: v.packageInfo?.downloadUrl ?? "", size: v.packageInfo ? String(v.packageInfo.downloadSizeBytes) : "", versionCode: String(v.versionCode), sha256: v.packageInfo?.sha256 ?? "" });
type Session = { saved: AppVersion | null; draft: Draft; conflict: boolean; latest: AppVersion | null };
const dirty = (s: Session) => JSON.stringify(s.draft) !== JSON.stringify(s.saved ? fields(s.saved) : empty);

export default function VersionEditor() {
  const app = useApplication(), { version } = useParams();
  const api = useMemo(() => createVersionClient(app.id), [app.id]);
  const detail = useQuery({ queryKey: [...resourceKey(app.id, "versions"), "detail", version], queryFn: () => api.get(version!), enabled: Boolean(version) });
  if (version && detail.isPending) return <Loading />;
  if (version && detail.isError) return <><ErrorNotice error={detail.error} /><Button onClick={() => void detail.refetch()}>重新加载</Button></>;
  return <Editor key={`${app.id}/${version ?? "new"}`} initial={detail.data ?? null} id={version ?? "new"} />;
}
function Editor({ initial, id }: { initial: AppVersion | null; id: string }) {
  const app = useApplication(), navigate = useNavigate(), client = useQueryClient(), toast = useToast();
  const api = useMemo(() => createVersionClient(app.id), [app.id]);
  const settings = useQuery({ queryKey: [...resourceKey(app.id, "versions"), "settings"], queryFn: () => api.settings(), enabled: initial !== null });
  const [session, setSession, remove] = useDraft<Session>(app.id, "versions", id, () => ({ saved: initial, draft: initial ? fields(initial) : { ...empty }, conflict: false, latest: null }), dirty);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState("basic"), [uploading, setUploading] = useState(false);
  function change<K extends keyof Draft>(name: K, value: Draft[K]) { setSession((s) => ({ ...s, draft: { ...s.draft, [name]: value } })); }
  const save = useMutation({ mutationFn: async () => {
    setError(null); setSession((s) => s, true);
    try {
      const d = session.draft;
      const parsed = createVersionSchema.safeParse({ version: d.version.trim(), releaseType: d.releaseType, segmentIds: d.releaseType === "gray" ? d.segmentIds : [], releaseNotes: d.releaseNotes, versionCode: Number(d.versionCode), packageInfo: [d.downloadUrl, d.size, d.sha256].every((v) => !v.trim()) ? null : { downloadUrl: d.downloadUrl.trim(), downloadSizeBytes: Number(d.size), sha256: d.sha256.trim() } });
      if (!parsed.success) {
        setTab(parsed.error.issues.some((issue) => issue.path[0] !== "packageInfo") ? "basic" : "package");
        throw new Error(parsed.error.issues.map((i) => i.message).join("；"));
      }
      const { version, ...input } = parsed.data;
      const saved = session.saved ? await api.update(session.saved.version, session.saved.revision, input) : await api.create(parsed.data);
      setSession({ saved, draft: fields(saved), conflict: false, latest: null });
      client.setQueryData([...resourceKey(app.id, "versions"), "detail", version], saved);
      void client.invalidateQueries({ queryKey: resourceKey(app.id, "versions") });
      toast.success("版本已保存");
      if (!session.saved) { remove(); navigate(`/admin/${app.id}/versions/${version}`, { replace: true }); }
    } catch (caught) {
      setError(caught);
      if (caught instanceof AdminApiError && caught.status === 409 && session.saved) {
        setSession((s) => ({ ...s, conflict: true }), true);
        try { const latest = await api.get(session.saved.version); setSession((s) => ({ ...s, latest }), true); } catch { /* Preserve input if refreshing also fails. */ }
      }
    } finally { setSession((s) => s); }
  } });
  const latest = useMutation({
    mutationFn: () => api.setLatest(session.saved!.version, settings.data!.revision),
    onMutate: () => setSession((s) => s, true),
    onSuccess: (value) => {
      client.setQueryData([...resourceKey(app.id, "versions"), "settings"], value);
      void client.invalidateQueries({ queryKey: resourceKey(app.id, "versions") });
      toast.success("最新版本已更新");
    },
    onSettled: () => setSession((s) => s),
  });
  const busy = save.isPending || latest.isPending || uploading;
  const isLatest = Boolean(session.saved) && settings.data?.latestVersion === session.saved?.version;
  const canSetLatest = Boolean(session.saved && settings.data) && session.saved?.releaseType === "full" && !isLatest && !busy && !session.conflict && !dirty(session) && !latest.isError;
  return <div className="resource-theme space-y-5">
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{session.saved ? `版本 ${session.saved.version}` : "新建版本"}</h1>
      {session.saved && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={!canSetLatest} title={session.saved.releaseType !== "full" ? "仅全量版本可设为最新" : dirty(session) ? "请先保存版本修改" : undefined}>{latest.isPending ? "设置中…" : isLatest ? "已是最新" : "设为最新"}</Button></AlertDialogTrigger>
        <AlertDialogContent className="resource-theme"><AlertDialogHeader><AlertDialogTitle>将 {session.saved.version} 设为最新版本？</AlertDialogTitle><AlertDialogDescription>灰度用户获得匹配版本与最新全量版本中的最高版本。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={!canSetLatest} onClick={() => latest.mutate()}>确认</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
    </header>
    {error !== null && <ErrorNotice error={error} />}
    {settings.isError && <ErrorNotice error={settings.error} />}
    {latest.isError && <div className="space-y-2"><ErrorNotice error={latest.error} /><Button type="button" size="sm" variant="outline" onClick={async () => { await client.invalidateQueries({ queryKey: resourceKey(app.id, "versions") }); latest.reset(); }}>刷新后重新操作</Button></div>}
    {session.conflict && <div role="alert" className="space-y-3 rounded-lg border p-4">
      <p>版本冲突，编辑内容已保留。请核对服务器内容后重试。</p>
      {session.latest && <><details><summary className="cursor-pointer">查看服务器最新内容</summary><p className="my-2 break-all">versionCode：{session.latest.versionCode}，发布类型：{session.latest.releaseType === "full" ? "全量" : "灰度"}，下载地址：{session.latest.packageInfo?.downloadUrl ?? "无"}，大小：{session.latest.packageInfo?.downloadSizeBytes ?? "未设置"}</p>{session.latest.packageInfo && <p className="break-all">SHA-256：{session.latest.packageInfo.sha256}</p>}<MarkdownPreview content={session.latest.releaseNotes} /></details>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { setSession((s) => ({ ...s, saved: s.latest, conflict: false, latest: null })); setError(null); }}>保留我的编辑，采用最新修订号</Button><Button type="button" variant="outline" onClick={() => { const saved = session.latest!; setSession({ saved, draft: fields(saved), conflict: false, latest: null }); setError(null); }}>加载服务器内容</Button></div></>}
      {!session.latest && <Button type="button" variant="outline" onClick={() => void api.get(id).then((latest) => setSession((s) => ({ ...s, latest }))).catch(setError)}>重新获取服务器内容</Button>}
    </div>}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label="版本设置" className="mb-6 flex gap-6 border-b">
          <Tabs.Trigger value="basic" disabled={busy} className="-mb-px border-b border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">基本信息</Tabs.Trigger>
          <Tabs.Trigger value="package" disabled={busy} className="-mb-px border-b border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">安装包</Tabs.Trigger>
          {app.id === "buaa-classhopper" && <Tabs.Trigger value="whitelist" disabled={busy || !session.saved} title={!session.saved ? "请先保存版本" : undefined} className="-mb-px border-b border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">白名单</Tabs.Trigger>}
        </Tabs.List>
        <form className="space-y-6" hidden={tab === "whitelist"} noValidate onSubmit={(e) => { e.preventDefault(); if (!busy && !session.conflict) save.mutate(); }}>
        <Tabs.Content value="basic" className="space-y-6">
          <fieldset disabled={busy} className="min-w-0 space-y-6">
            <div className="space-y-2"><Label htmlFor="version-number">版本号</Label><Input id="version-number" className="max-w-sm" placeholder="1.4.1" value={session.draft.version} readOnly={Boolean(session.saved)} required onChange={(e) => change("version", e.target.value)} /></div>
            <div className="max-w-sm space-y-2"><Label htmlFor="version-code">versionCode</Label><Input id="version-code" type="number" min="1" max="2100000000" step="1" value={session.draft.versionCode} onChange={(e) => change("versionCode", e.target.value)} /></div>
            <MarkdownEditor id="version-notes" label="更新说明（Markdown）" value={session.draft.releaseNotes} onChange={(value) => change("releaseNotes", value)} disabled={busy}
              onUploadingChange={(active) => { setUploading(active); setSession((s) => s, active); }} placeholder="输入更新说明，支持 Markdown…" />
            <hr className="border-t" />
            <div className="space-y-5">
              <SegmentedChoice<AppVersion["releaseType"]> label="发布类型" value={session.draft.releaseType} options={[{ value: "gray", label: "灰度", disabled: Boolean(session.saved) && (!settings.data || settings.data.latestVersion === session.saved?.version) }, { value: "full", label: "全量" }]} onChange={(value) => change("releaseType", value)} />
              {session.draft.releaseType === "gray" ? <SegmentPicker value={session.draft.segmentIds} onChange={(ids) => change("segmentIds", ids)} disabled={busy} /> : session.saved?.segmentIds.length ? <p className="text-sm text-muted-foreground">保存后将解除此版本的全部人群关联。</p> : null}
            </div>
          </fieldset>
        </Tabs.Content>
        <Tabs.Content value="package">
          <fieldset disabled={busy} className="max-w-2xl space-y-6">
            <div className="space-y-2"><Label htmlFor="version-url">下载地址</Label><Input id="version-url" type="url" maxLength={2048} placeholder="https://example.com/app.apk" value={session.draft.downloadUrl} onChange={(e) => change("downloadUrl", e.target.value)} /></div>
            <div className="max-w-sm space-y-2"><Label htmlFor="version-size">文件大小（字节）</Label><Input id="version-size" type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} value={session.draft.size} onChange={(e) => change("size", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="package-sha256">SHA-256</Label><Input id="package-sha256" maxLength={64} value={session.draft.sha256} onChange={(e) => change("sha256", e.target.value)} /></div>
          </fieldset>
        </Tabs.Content>
          {tab !== "whitelist" && <EditorActions><Button type="submit" disabled={busy || session.conflict || (Boolean(session.saved) && !dirty(session))}>{save.isPending || uploading ? "保存中…" : "保存版本"}</Button></EditorActions>}
        </form>
        {app.id === "buaa-classhopper" && session.saved && <Tabs.Content value="whitelist"><VersionWhitelist version={session.saved.version} /></Tabs.Content>}
      </Tabs.Root>
  </div>;
}
