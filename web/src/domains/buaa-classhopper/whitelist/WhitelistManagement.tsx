import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessPolicy } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import { fetchPolicy, patchPolicy, PolicyApiError } from "./api";
import { buildPatch, createEmptyDraft, getDraftCounts, normalizeDraft, stageAddition, stageRemoval, undoRemoval, type PolicyDraft, type PolicyField } from "./draft";
import { WhitelistSection } from "./WhitelistSection";
import { useApplication } from "../../../platform/AppContext";
import { useDraft } from "../../../platform/drafts";
import { resourceKey } from "../../../platform/query";
import { ErrorNotice, Loading, useToast } from "../../../platform/feedback";
import { Button } from "@/components/ui/button";

type Session = { policy: AccessPolicy; draft: PolicyDraft };
const dirty = (value: Session) => buildPatch(value.policy, value.draft) !== null;
export default function WhitelistManagement() {
  const app = useApplication();
  if (app.id !== "buaa-classhopper") return <h1>页面不存在</h1>;
  return <WhitelistLoader />;
}
function WhitelistLoader() {
  const app = useApplication();
  const query = useQuery({ queryKey: resourceKey(app.id, "whitelist"), queryFn: ({ signal }) => fetchPolicy(signal) });
  if (query.isPending) return <Loading />;
  if (query.isError) return <div className="space-y-4"><h1 className="text-2xl font-semibold">{query.error instanceof PolicyApiError && query.error.kind === "uninitialized" ? "白名单尚未初始化" : "无法加载白名单"}</h1><ErrorNotice error={query.error} /><Button onClick={() => void query.refetch()}>重新加载</Button></div>;
  return <WhitelistEditor initial={query.data} />;
}
function WhitelistEditor({ initial }: { initial: AccessPolicy }) {
  const app = useApplication();
  const client = useQueryClient();
  const toast = useToast();
  const [session, setSession] = useDraft<Session>(app.id, "whitelist", "policy", () => ({ policy: initial, draft: createEmptyDraft() }), dirty);
  const { policy, draft } = session;
  const counts = getDraftCounts(normalizeDraft(policy, draft));
  const save = useMutation({ mutationFn: async () => {
    const patch = buildPatch(policy, draft);
    if (!patch) return;
    setSession((previous) => previous, true);
    try {
      const updated = await patchPolicy(patch);
      setSession({ policy: updated, draft: createEmptyDraft() });
      client.setQueryData(resourceKey(app.id, "whitelist"), updated);
      toast.success("白名单已保存");
    } catch (caught) {
      if (caught instanceof PolicyApiError && caught.kind === "conflict") {
        try {
          const latest = await fetchPolicy();
          setSession((previous) => ({ policy: latest, draft: normalizeDraft(latest, previous.draft) }));
          client.setQueryData(resourceKey(app.id, "whitelist"), latest);
          toast.info("数据已更新，请检查后再次保存");
        } catch (reloadError) { toast.error(reloadError); }
      } else toast.error(caught);
    } finally { setSession((previous) => previous); }
  } });
  function add(field: PolicyField, value: string) {
    const result = stageAddition(policy, draft, field, value);
    setSession({ policy, draft: result.draft }); return result.error;
  }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-2xl font-semibold">白名单管理</h1><p className="text-sm text-muted-foreground">当前版本 <code>{policy.revision}</code></p></div>
      <p className="text-sm text-muted-foreground">{counts.total} 项待处理 · 新增 {counts.added} · 删除 {counts.removed}</p></header>
    <div className="grid gap-6 lg:grid-cols-2">{([{ title: "学号白名单", field: "studentIds", inputLabel: "新增学号", placeholder: "例如 23370003" }, { title: "姓名白名单", field: "names", inputLabel: "新增姓名", placeholder: "例如 王五" }] as const).map((section) => <WhitelistSection key={section.field} {...section} policy={policy} draft={draft} disabled={save.isPending} onAdd={add}
      onRemove={(field, value) => { setSession((previous) => ({ ...previous, draft: stageRemoval(previous.draft, field, value) })); }}
      onUndo={(field, value) => setSession((previous) => ({ ...previous, draft: undoRemoval(previous.draft, field, value) }))} />)}</div>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-6"><p className="text-sm text-muted-foreground">{counts.total === 0 ? "当前没有未保存的更改" : "更改保存在当前会话，保存后才会生效"}</p><div className="flex gap-3">
      <Button variant="outline" disabled={save.isPending || counts.total === 0} onClick={() => { setSession({ policy, draft: createEmptyDraft() }); toast.info("已放弃未保存的更改"); }}>放弃更改</Button>
      <Button disabled={save.isPending || counts.total === 0} onClick={() => save.mutate()}>{save.isPending ? "保存中…" : "保存更改"}</Button></div></footer>
  </div>;
}
