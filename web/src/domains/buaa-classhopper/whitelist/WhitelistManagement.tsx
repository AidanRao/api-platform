import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EditorActions } from "@/components/ui/editor-actions";
import type { PolicyConfig } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import { useApplication } from "../../../platform/AppContext";
import { useDraft } from "../../../platform/drafts";
import { resourceKey } from "../../../platform/query";
import { AdminApiError } from "../../../platform/api";
import { ErrorNotice, Loading, useToast } from "../../../platform/feedback";
import { SegmentPicker } from "../../../features/segments/SegmentPicker";
import { MemberPreview } from "../../../features/segments/MemberPreview";
import { fetchPolicy, savePolicy } from "./api";
import "../../../platform/resource-theme.css";

type Session = { saved: PolicyConfig; ids: string[]; conflict: boolean; latest: PolicyConfig | null };
const dirty = (s: Session) => JSON.stringify(s.ids) !== JSON.stringify(s.saved.segmentIds);
export default function WhitelistManagement() {
  const app = useApplication();
  const config = useQuery({ queryKey: resourceKey(app.id, "whitelist"), queryFn: ({ signal }) => fetchPolicy(signal), enabled: app.id === "buaa-classhopper" });
  if (app.id !== "buaa-classhopper") return <h1>页面不存在</h1>;
  if (config.isPending) return <Loading />;
  if (config.isError) return <><ErrorNotice error={config.error} /><Button variant="outline" onClick={() => void config.refetch()}>重新加载</Button></>;
  return <Editor key={app.id} initial={config.data} />;
}
function Editor({ initial }: { initial: PolicyConfig }) {
  const app = useApplication(), client = useQueryClient(), toast = useToast();
  const [session, set] = useDraft<Session>(app.id, "whitelist", "policy", () => ({ saved: initial, ids: initial.segmentIds, conflict: false, latest: null }), dirty);
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: async () => {
    setError(null); set((s) => s, true);
    try {
      const saved = await savePolicy({ revision: session.saved.revision, segmentIds: session.ids });
      set({ saved, ids: saved.segmentIds, conflict: false, latest: null });
      client.setQueryData(resourceKey(app.id, "whitelist"), saved); toast.success("白名单配置已保存");
    } catch (e) {
      setError(e);
      if (e instanceof AdminApiError && e.status === 409) {
        set((s) => ({ ...s, conflict: true }), true);
        try { const latest = await fetchPolicy(); set((s) => ({ ...s, latest }), true); } catch { /* Preserve the chosen segments. */ }
      }
    } finally { set((s) => s); }
  } });
  return <div className="resource-theme space-y-5">
    <h1 className="text-2xl font-semibold">白名单管理</h1>
    {error !== null && <ErrorNotice error={error} />}
    {session.conflict && <div role="alert" className="space-y-3 rounded-md border p-4"><p className="text-sm">配置已变化，所选人群已保留。</p>{session.latest ? <><p className="break-all text-xs text-muted-foreground">服务器所选人群：{session.latest.segmentIds.join("，") || "无"}</p><Button type="button" variant="outline" onClick={() => { set((s) => ({ ...s, saved: s.latest!, latest: null, conflict: false })); setError(null); }}>保留选择，采用最新修订号</Button></> : <Button type="button" variant="outline" onClick={() => void fetchPolicy().then((latest) => set((s) => ({ ...s, latest }))).catch(setError)}>重新获取配置</Button>}</div>}
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (!save.isPending && !session.conflict) save.mutate(); }}>
      <SegmentPicker value={session.ids} disabled={save.isPending} onChange={(ids) => set((s) => ({ ...s, ids }))} />
      <MemberPreview segmentIds={session.ids} fields={["student_name", "student_id"]} />
      <EditorActions><Button type="submit" disabled={save.isPending || session.conflict || !dirty(session)}>{save.isPending ? "保存中…" : "保存配置"}</Button><Button type="button" variant="outline" disabled={save.isPending || !dirty(session)} onClick={() => { set((s) => ({ ...s, ids: s.saved.segmentIds, conflict: false, latest: null })); setError(null); }}>放弃更改</Button></EditorActions>
    </form>
  </div>;
}
