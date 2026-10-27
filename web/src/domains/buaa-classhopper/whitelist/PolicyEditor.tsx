import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { policyUpdateSchema, type PolicyConfig, type PolicyResult } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import { Button } from "@/components/ui/button";
import { EditorActions } from "@/components/ui/editor-actions";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
import { SegmentPicker } from "../../../features/segments/SegmentPicker";
import { MemberPreview } from "../../../features/segments/MemberPreview";
import { useDraft } from "../../../platform/drafts";
import { resourceKey } from "../../../platform/query";
import { AdminApiError } from "../../../platform/api";
import { ErrorNotice, Loading, useToast } from "../../../platform/feedback";
import { fetchPolicy, savePolicy } from "./api";

const appId = "buaa-classhopper";
const policyKey = resourceKey(appId, "whitelist");
function useWhitelistPolicy() {
  return useQuery({ queryKey: policyKey, queryFn: ({ signal }) => fetchPolicy(signal) });
}

function describeResult(result: PolicyResult | null): string {
  if (result === null) return "使用默认策略";
  if (result.type === "segments") return `指定人群（${result.segmentIds.length}）`;
  return result.type === "empty" ? "返回空名单" : "不可用";
}
function describeVersionPolicy(config: PolicyConfig, version: string): string {
  const rule = config.rules.find((rule) => rule.version === version);
  return describeResult(rule ? { type: "segments", segmentIds: rule.segmentIds } : null);
}

type Draft = { type: "version"; version: string; segmentIds: string[] }
  | { type: "defaults"; default: PolicyConfig["default"] };
type Session = { saved: PolicyConfig; draft: Draft; conflict: boolean; latest: PolicyConfig | null };
function select(config: PolicyConfig, version?: string): Draft {
  return version === undefined ? { type: "defaults", default: config.default }
    : { type: "version", version, segmentIds: segmentIdsForVersion(config, version) };
}
function segmentIdsForVersion(config: PolicyConfig, version: string): string[] {
  return config.rules.find((rule) => rule.version === version)?.segmentIds ?? [];
}
const dirty = (s: Session) => JSON.stringify(applyDraft(s.saved, s.draft)) !== JSON.stringify(s.saved);
function applyDraft(saved: PolicyConfig, draft: Draft): PolicyConfig {
  if (draft.type === "defaults") return { ...saved, default: draft.default };
  const rules = saved.rules.flatMap((rule) => rule.version !== draft.version ? [rule]
    : draft.segmentIds.length ? [{ version: draft.version, segmentIds: draft.segmentIds }] : []);
  if (draft.segmentIds.length && !saved.rules.some((rule) => rule.version === draft.version)) {
    rules.push({ version: draft.version, segmentIds: draft.segmentIds });
  }
  return { ...saved, rules };
}

export function VersionWhitelist({ version }: { version: string }) {
  const [defaults, setDefaults] = useState(false);
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3">
      {defaults && <h2 className="text-base font-semibold">默认策略</h2>}
      <Button type="button" variant="outline" className="ml-auto" onClick={() => setDefaults(!defaults)}>{defaults ? "返回白名单" : "默认策略"}</Button>
    </div>
    <PolicyEditor key={defaults ? "defaults" : version} version={defaults ? undefined : version} />
  </div>;
}

function PolicyEditor({ version }: { version?: string }) {
  const config = useWhitelistPolicy();
  if (config.isPending) return <Loading />;
  if (config.isError) return <div className="space-y-3 p-5"><ErrorNotice error={config.error} /><Button type="button" variant="outline" onClick={() => void config.refetch()}>重新加载白名单</Button></div>;
  return <PolicyForm initial={config.data} version={version} />;
}

function PolicyForm({ initial, version }: { initial: PolicyConfig; version?: string }) {
  const client = useQueryClient(), toast = useToast();
  const [stored, set] = useDraft<Session>(appId, "whitelist", version === undefined ? "defaults" : `version:${version}`,
    () => ({ saved: initial, draft: select(initial, version), conflict: false, latest: null }), dirty);
  // Clean editors follow the shared cache; dirty editors retain their original revision.
  const session = !dirty(stored) && !stored.conflict && stored.saved.revision < initial.revision
    ? { ...stored, saved: initial, draft: select(initial, version) } : stored;
  const [error, setError] = useState<unknown>(null);
  const update = (draft: Draft) => set({ ...session, draft });
  async function loadLatest(busy = false) {
    const latest = await fetchPolicy();
    client.setQueryData(policyKey, latest);
    set((s) => ({ ...s, latest, conflict: true }), busy);
  }
  const save = useMutation({ mutationKey: policyKey, mutationFn: async () => {
    setError(null); set(session, true);
    try {
      const saved = await savePolicy(policyUpdateSchema.parse(applyDraft(session.saved, session.draft)));
      set({ saved, draft: select(saved, version), conflict: false, latest: null });
      client.setQueryData(policyKey, saved);
      toast.success(version === undefined ? "默认策略已保存" : "白名单已保存");
    } catch (caught) {
      setError(caught);
      if (caught instanceof AdminApiError && caught.status === 409) {
        set((s) => ({ ...s, conflict: true }), true);
        try { await loadLatest(true); } catch { /* Keep the draft and allow a manual retry. */ }
      }
    } finally { set((s) => s); }
  } });
  const busy = useIsMutating({ mutationKey: policyKey }) > 0;
  const actions = <>
    <Button type="submit" disabled={busy || session.conflict || !dirty(session)}>{busy ? "保存中…" : version === undefined ? "保存默认策略" : "保存白名单"}</Button>
    <Button type="button" variant="outline" disabled={busy || (!dirty(session) && !session.conflict)} onClick={() => {
      const saved = session.latest ?? session.saved;
      set({ saved, draft: select(saved, version), conflict: false, latest: null }); setError(null);
    }}>放弃更改</Button>
  </>;
  return <form aria-label={version === undefined ? "默认策略配置" : "版本白名单配置"}
    className="space-y-6"
    noValidate onSubmit={(e) => { e.preventDefault(); if (!busy && !session.conflict && dirty(session)) save.mutate(); }}>
    <div className="space-y-6">
      {error !== null && <ErrorNotice error={error} />}
      {session.conflict && <div role="alert" className="space-y-3 border p-4 text-sm">
        <p>配置已变化，本地更改已保留。</p>
        {session.latest ? <>
          <details><summary className="cursor-pointer">查看服务器配置</summary><div className="mt-2 space-y-1">
            {version === undefined ? <><p>版本未匹配：{describeResult(session.latest.default.unmatched)}</p><p>版本号缺失或无效：{describeResult(session.latest.default.invalidVersion)}</p></>
              : <p>{version}：{describeVersionPolicy(session.latest, version)}</p>}
            {(version === undefined ? [session.latest.default.unmatched, session.latest.default.invalidVersion].flatMap((result) => result.type === "segments" ? [result.segmentIds] : [])
              : [segmentIdsForVersion(session.latest, version)]).map((ids, index) => <p key={index} className="break-all">人群：{ids.join("，") || "无"}</p>)}
          </div></details>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { set({ ...session, saved: session.latest!, conflict: false, latest: null }); setError(null); }}>保留更改，采用最新修订号</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { const saved = session.latest!; set({ saved, draft: select(saved, version), conflict: false, latest: null }); setError(null); }}>加载服务器配置</Button>
          </div>
        </> : <Button type="button" variant="outline" disabled={busy} onClick={() => void loadLatest().catch(setError)}>重新获取配置</Button>}
      </div>}
      {session.draft.type === "version" ? <div className="space-y-4">
        <SegmentPicker value={session.draft.segmentIds} disabled={busy} onChange={(segmentIds) => {
          if (session.draft.type === "version") update({ ...session.draft, segmentIds });
        }} />
        {session.draft.segmentIds.length > 0 && <MemberPreview segmentIds={session.draft.segmentIds} fields={["student_name", "student_id"]} />}
      </div>
        : <>
          <section aria-label="版本未匹配" className="space-y-4"><h2 className="text-sm font-semibold">版本未匹配</h2>
            <ResultEditor value={session.draft.default.unmatched} disabled={busy} onChange={(unmatched) => {
              if (session.draft.type === "defaults") update({ ...session.draft, default: { ...session.draft.default, unmatched } });
            }} />
          </section>
          <section aria-label="版本号缺失或无效" className="space-y-4 border-t pt-6"><h2 className="text-sm font-semibold">版本号缺失或无效</h2>
            <ResultEditor value={session.draft.default.invalidVersion} disabled={busy} onChange={(invalidVersion) => {
              if (session.draft.type === "defaults") update({ ...session.draft, default: { ...session.draft.default, invalidVersion } });
            }} />
          </section>
        </>}
    </div>
    <EditorActions>{actions}</EditorActions>
  </form>;
}

function ResultEditor({ value, disabled, onChange }: {
  value: PolicyResult; disabled: boolean; onChange: (value: PolicyResult) => void;
}) {
  return <div className="space-y-4">
    <SegmentedChoice label="返回结果" value={value.type} disabled={disabled}
      options={[{ value: "segments", label: "指定人群" }, { value: "empty", label: "返回空名单" }, { value: "unavailable", label: "不可用" }]}
      onChange={(type) => onChange(type === "segments" ? { type, segmentIds: [] } : { type })} />
    {value.type === "segments" && <>
      <SegmentPicker value={value.segmentIds} disabled={disabled} onChange={(segmentIds) => onChange({ type: "segments", segmentIds })} />
      <MemberPreview segmentIds={value.segmentIds} fields={["student_name", "student_id"]} />
    </>}
  </div>;
}
