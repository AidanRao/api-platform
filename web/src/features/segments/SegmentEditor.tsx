import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditorActions } from "@/components/ui/editor-actions";
import { emptyMembers, segmentInputSchema, type Segment } from "../../../../src/features/segments/schema";
import { useDraft } from "../../platform/drafts";
import { useAdminPageTitle } from "../../platform/AdminHeader";
import { AdminApiError } from "../../platform/api";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { segmentClient, segmentKey } from "./api";
import { MemberListEditor } from "./MemberListEditor";
import { SegmentName } from "./SegmentName";
import { createMemberDraft, memberDraftValues, type MemberDraft } from "./member-draft";
import "../../platform/resource-theme.css";

type Draft = { name: string; members: MemberDraft };
const empty = (): Draft => ({ name: "", members: createMemberDraft() });
const fields = (s: Segment): Draft => ({ name: s.name, members: createMemberDraft(s.members) });
type Session = { saved: Segment | null; draft: Draft; latest: Segment | null; conflict: boolean };
const dirty = (s: Session) => s.draft.name !== (s.saved?.name ?? "") || Object.values(s.draft.members.pending).some((text) => text !== "")
  || JSON.stringify(memberDraftValues(s.draft.members)) !== JSON.stringify(s.saved?.members ?? emptyMembers());

export default function SegmentEditor() {
  const { id } = useParams();
  const query = useQuery({ queryKey: [...segmentKey, "detail", id], queryFn: () => segmentClient.get(id!), enabled: Boolean(id) });
  if (id && query.isPending) return <Loading />;
  if (id && query.isError) return <><ErrorNotice error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>重新加载</Button></>;
  return <Editor key={id ?? "new"} id={id ?? "new"} initial={query.data ?? null} />;
}
function Editor({ id, initial }: { id: string; initial: Segment | null }) {
  const client = useQueryClient(), navigate = useNavigate(), toast = useToast();
  const [session, set, remove] = useDraft<Session>(null, "segments", id, () => ({ saved: initial, draft: initial ? fields(initial) : empty(), latest: null, conflict: false }), dirty);
  const [error, setError] = useState<unknown>(null);
  const formId = useId();
  useAdminPageTitle(session.saved?.name ?? "新建人群");
  const save = useMutation({ mutationFn: async () => {
    setError(null); set((s) => s, true);
    try {
      const d = session.draft;
      const input = segmentInputSchema.safeParse({ name: d.name, members: memberDraftValues(d.members) });
      if (!input.success) throw new Error(input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；"));
      const value = session.saved ? await segmentClient.update(id, session.saved.revision, input.data) : await segmentClient.create(input.data);
      set({ saved: value, draft: fields(value), latest: null, conflict: false });
      client.setQueryData([...segmentKey, "detail", value.id], value);
      void client.invalidateQueries({ queryKey: segmentKey }); toast.success("人群已保存");
      if (!session.saved) { remove(); navigate(`/admin/segments/${value.id}`, { replace: true }); }
    } catch (e) {
      setError(e);
      if (e instanceof AdminApiError && e.status === 409 && session.saved) {
        set((s) => ({ ...s, conflict: true }), true);
        try { const latest = await segmentClient.get(id); set((s) => ({ ...s, latest }), true); } catch { /* Keep draft when refresh fails. */ }
      }
    } finally { set((s) => s); }
  } });
  return <div className="resource-theme space-y-5">
    {session.saved ? <SegmentName name={session.draft.name} onChange={(name) => set((s) => ({ ...s, draft: { ...s.draft, name } }))} formId={formId} disabled={save.isPending} /> : <h1 className="text-2xl font-semibold">新建人群</h1>}
    {error !== null && <ErrorNotice error={error} />}
    {session.conflict && <div className="space-y-3 rounded-md border p-4" role="alert"><p className="text-sm">人群已被修改，编辑内容已保留。</p>{session.latest ? <>
      <details><summary className="cursor-pointer text-sm">核对服务器内容</summary><p>{session.latest.name}</p><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(session.latest.members, null, 2)}</pre></details>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { set((s) => ({ ...s, saved: s.latest, latest: null, conflict: false })); setError(null); }}>保留编辑，采用最新修订号</Button><Button type="button" variant="outline" onClick={() => { const value = session.latest!; set({ saved: value, draft: fields(value), latest: null, conflict: false }); setError(null); }}>加载服务器内容</Button></div>
    </> : <Button type="button" variant="outline" onClick={() => void segmentClient.get(id).then((latest) => set((s) => ({ ...s, latest }))).catch(setError)}>重新获取服务器内容</Button>}</div>}
    <form id={formId} className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!save.isPending && !session.conflict) save.mutate(); }}>
      <fieldset className="space-y-5" disabled={save.isPending}>
        {!session.saved && <div className="max-w-xl space-y-2"><Label htmlFor={`${formId}-name`}>人群名称</Label><Input id={`${formId}-name`} autoFocus placeholder="输入人群名称" maxLength={100} required value={session.draft.name} onChange={(e) => set((s) => ({ ...s, draft: { ...s.draft, name: e.target.value } }))} /></div>}
        <MemberListEditor draft={session.draft.members} onChange={(members) => set((s) => ({ ...s, draft: { ...s.draft, members } }))} />
      </fieldset>
      <EditorActions><Button type="submit" disabled={save.isPending || session.conflict || (Boolean(session.saved) && !dirty(session))}>{save.isPending ? "保存中…" : "保存人群"}</Button></EditorActions>
    </form>
  </div>;
}
