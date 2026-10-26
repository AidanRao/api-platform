import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
import { EditorActions } from "@/components/ui/editor-actions";
import { policyUpdateSchema, type PolicyConfig, type PolicyResult } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import { useApplication } from "../../../platform/AppContext";
import { useDraft } from "../../../platform/drafts";
import { resourceKey } from "../../../platform/query";
import { AdminApiError } from "../../../platform/api";
import { ErrorNotice, Loading, useToast } from "../../../platform/feedback";
import { SegmentPicker } from "../../../features/segments/SegmentPicker";
import { MemberPreview } from "../../../features/segments/MemberPreview";
import { fetchPolicy, savePolicy } from "./api";
import "../../../platform/resource-theme.css";

type RuleDraft = PolicyConfig["rules"][number] & { key: string };
type Draft = { rules: RuleDraft[]; default: PolicyConfig["default"] };
type Session = { saved: PolicyConfig; draft: Draft; conflict: boolean; latest: PolicyConfig | null };
const toDraft = (config: PolicyConfig): Draft => ({ rules: config.rules.map((rule) => ({ ...rule, key: crypto.randomUUID() })), default: config.default });
const toConfig = (s: Session): PolicyConfig => ({ revision: s.saved.revision, rules: s.draft.rules.map(({ key: _key, ...rule }) => rule), default: s.draft.default });
const dirty = (s: Session) => JSON.stringify(toConfig(s)) !== JSON.stringify(s.saved);

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
  const [session, set] = useDraft<Session>(app.id, "whitelist", "policy", () => ({ saved: initial, draft: toDraft(initial), conflict: false, latest: null }), dirty);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState("versions");
  const save = useMutation({ mutationFn: async () => {
    setError(null); set((s) => s, true);
    try {
      const parsed = policyUpdateSchema.safeParse(toConfig(session));
      if (!parsed.success) {
        setTab(parsed.error.issues.some((issue) => issue.path[0] === "rules") ? "versions" : "default");
        throw new Error(parsed.error.issues.map((issue) => issue.message).join("；"));
      }
      const saved = await savePolicy(parsed.data);
      set({ saved, draft: toDraft(saved), conflict: false, latest: null });
      client.setQueryData(resourceKey(app.id, "whitelist"), saved); toast.success("白名单配置已保存");
    } catch (e) {
      setError(e);
      if (e instanceof AdminApiError && e.status === 409) {
        set((s) => ({ ...s, conflict: true }), true);
        try { const latest = await fetchPolicy(); set((s) => ({ ...s, latest }), true); } catch { /* Preserve the complete local draft. */ }
      }
    } finally { set((s) => s); }
  } });
  const updateRule = (key: string, change: Partial<Pick<RuleDraft, "version" | "result">>) => set((s) => ({ ...s, draft: { ...s.draft, rules: s.draft.rules.map((rule) => rule.key === key ? { ...rule, ...change } : rule) } }));
  return <div className="resource-theme space-y-5">
    <h1 className="text-2xl font-semibold">白名单管理</h1>
    {error !== null && <ErrorNotice error={error} />}
    {session.conflict && <div role="alert" className="space-y-3 rounded-md border p-4">
      <p className="text-sm">配置已变化，本地更改已保留。</p>
      {session.latest ? <>
        <details className="text-sm"><summary className="cursor-pointer">查看服务器配置</summary><ul className="mt-2 space-y-1">
          {session.latest.rules.map((rule) => <li key={rule.version} className="break-all">{rule.version}：{describeResult(rule.result)}</li>)}
          <li className="break-all">版本未匹配：{describeResult(session.latest.default.unmatched)}</li>
          <li className="break-all">版本号缺失或无效：{describeResult(session.latest.default.invalidVersion)}</li>
        </ul></details>
        <Button type="button" variant="outline" onClick={() => { set((s) => ({ ...s, saved: s.latest!, latest: null, conflict: false })); setError(null); }}>保留更改，采用最新修订号</Button>
      </> : <Button type="button" variant="outline" onClick={() => void fetchPolicy().then((latest) => set((s) => ({ ...s, latest }))).catch(setError)}>重新获取配置</Button>}
    </div>}
    <form className="space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); if (!save.isPending && !session.conflict && dirty(session)) save.mutate(); }}>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label="白名单策略" className="mb-6 flex gap-6 border-b">
          <Tabs.Trigger value="versions" disabled={save.isPending} className="-mb-px border-b border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">版本策略</Tabs.Trigger>
          <Tabs.Trigger value="default" disabled={save.isPending} className="-mb-px border-b border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">默认策略</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="versions" className="space-y-4">
          <div className="flex justify-end"><Button type="button" variant="outline" disabled={save.isPending} onClick={() => set((s) => ({ ...s, draft: { ...s.draft, rules: [...s.draft.rules, { key: crypto.randomUUID(), version: "", result: { type: "empty" } }] } }))}>添加规则</Button></div>
          {session.draft.rules.map((rule, index) => <RuleEditor key={rule.key} rule={rule} index={index} disabled={save.isPending} onChange={(change) => updateRule(rule.key, change)} onRemove={() => set((s) => ({ ...s, draft: { ...s.draft, rules: s.draft.rules.filter((item) => item.key !== rule.key) } }))} />)}
        </Tabs.Content>
        <Tabs.Content value="default" className="space-y-6">
          <section aria-label="版本未匹配" className="space-y-4">
            <h2 className="font-semibold">版本未匹配</h2>
            <ResultEditor value={session.draft.default.unmatched} disabled={save.isPending} onChange={(value) => set((s) => ({ ...s, draft: { ...s.draft, default: { ...s.draft.default, unmatched: value } } }))} />
          </section>
          <section aria-label="版本号缺失或无效" className="space-y-4 border-t pt-6">
            <h2 className="font-semibold">版本号缺失或无效</h2>
            <ResultEditor value={session.draft.default.invalidVersion} disabled={save.isPending} onChange={(value) => set((s) => ({ ...s, draft: { ...s.draft, default: { ...s.draft.default, invalidVersion: value } } }))} />
          </section>
        </Tabs.Content>
      </Tabs.Root>
      <EditorActions><Button type="submit" disabled={save.isPending || session.conflict || !dirty(session)}>{save.isPending ? "保存中…" : "保存配置"}</Button><Button type="button" variant="outline" disabled={save.isPending || !dirty(session)} onClick={() => { set((s) => ({ ...s, draft: toDraft(s.saved), conflict: false, latest: null })); setError(null); }}>放弃更改</Button></EditorActions>
    </form>
  </div>;
}

function RuleEditor({ rule, index, disabled, onChange, onRemove }: { rule: RuleDraft; index: number; disabled: boolean; onChange: (change: Partial<Pick<RuleDraft, "version" | "result">>) => void; onRemove: () => void }) {
  const id = useId();
  return <section aria-label={`版本规则 ${index + 1}`} className="min-w-0 space-y-4 rounded-md border p-4">
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0 space-y-2"><Label htmlFor={id}>版本号</Label><Input id={id} className="max-w-xs" required placeholder="x.y.z" value={rule.version} disabled={disabled} onChange={(e) => onChange({ version: e.target.value })} /></div>
      <Button type="button" variant="ghost" disabled={disabled} onClick={onRemove}>删除规则</Button>
    </div>
    <ResultEditor value={rule.result} disabled={disabled} onChange={(result) => onChange({ result })} />
  </section>;
}

function ResultEditor({ value, disabled, onChange }: { value: PolicyResult; disabled: boolean; onChange: (value: PolicyResult) => void }) {
  return <div className="space-y-4">
    <SegmentedChoice label="返回结果" value={value.type} options={[{ value: "segments", label: "指定人群" }, { value: "empty", label: "返回空名单" }, { value: "unavailable", label: "不可用" }]} disabled={disabled} onChange={(type) => onChange(type === "segments" ? { type, segmentIds: [] } : { type })} />
    {value.type === "segments" && <>
      <SegmentPicker value={value.segmentIds} disabled={disabled} onChange={(segmentIds) => onChange({ type: "segments", segmentIds })} />
      <MemberPreview segmentIds={value.segmentIds} fields={["student_name", "student_id"]} />
    </>}
  </div>;
}

function describeResult(result: PolicyResult): string {
  if (result.type === "empty") return "返回空名单";
  return result.type === "unavailable" ? "不可用" : result.segmentIds.join("，") || "空名单";
}
