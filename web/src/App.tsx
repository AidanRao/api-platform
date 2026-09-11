import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { AccessPolicy } from "../../src/domains/buaa-classhopper/access-policy.schema";
import { fetchPolicy, patchPolicy, PolicyApiError } from "./api";
import {
  buildPatch,
  createEmptyDraft,
  getDraftCounts,
  normalizeDraft,
  stageAddition,
  stageRemoval,
  undoRemoval,
  type PolicyDraft,
  type PolicyField,
} from "./draft";
import { WhitelistSection } from "./WhitelistSection";

type PageState = "loading" | "ready" | "uninitialized" | "failed";

export function App() {
  const [state, setState] = useState<PageState>("loading");
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(createEmptyDraft);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    setError(null);
    try {
      const loadedPolicy = await fetchPolicy(signal);
      setPolicy(loadedPolicy);
      setDraft(createEmptyDraft());
      setState("ready");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught instanceof PolicyApiError && caught.kind === "uninitialized") {
        setPolicy(null);
        setState("uninitialized");
        return;
      }
      setError(errorMessage(caught, "加载失败，请检查网络后重试"));
      setState("failed");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state === "loading") {
    return <PageMessage title="正在加载白名单…" busy />;
  }
  if (state === "uninitialized") {
    return (
      <PageMessage
        title="白名单尚未初始化"
        detail="请先通过 seed 命令建立初始数据，然后重新加载。"
        action={<button onClick={() => void load()}>重新加载</button>}
      />
    );
  }
  if (state === "failed" || policy === null) {
    return (
      <PageMessage
        title="无法加载白名单"
        detail={error ?? "请重新加载后再试"}
        action={<button onClick={() => void load()}>重新加载</button>}
      />
    );
  }

  const counts = getDraftCounts(normalizeDraft(policy, draft));

  function add(field: PolicyField, value: string): string | null {
    const result = stageAddition(policy as AccessPolicy, draft, field, value);
    setDraft(result.draft);
    setNotice(null);
    return result.error;
  }

  async function save() {
    const patch = buildPatch(policy as AccessPolicy, draft);
    if (patch === null || saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updatedPolicy = await patchPolicy(patch);
      setPolicy(updatedPolicy);
      setDraft(createEmptyDraft());
      setNotice("白名单已保存");
    } catch (caught) {
      if (caught instanceof PolicyApiError && caught.kind === "conflict") {
        try {
          const latestPolicy = await fetchPolicy();
          setPolicy(latestPolicy);
          setDraft((current) => normalizeDraft(latestPolicy, current));
          setNotice("数据已更新，请检查后再次保存");
        } catch (reloadError) {
          setError(errorMessage(reloadError, "刷新最新白名单失败，请重新加载"));
        }
      } else {
        setError(errorMessage(caught, "保存失败，请稍后重试"));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">BUAA ClassHopper</p>
          <h1>白名单管理</h1>
          <p className="revision">当前版本 <code>{policy.revision}</code></p>
        </div>
        <div className="change-summary" aria-live="polite">
          <strong>{counts.total}</strong>
          <span>项待处理</span>
          <small>新增 {counts.added} · 删除 {counts.removed}</small>
        </div>
      </header>

      {notice !== null ? <div className="notice" role="status">{notice}</div> : null}
      {error !== null ? <div className="error-banner" role="alert">{error}</div> : null}

      <div className="panel-grid">
        <WhitelistSection
          title="学号白名单"
          field="studentIds"
          inputLabel="新增学号"
          placeholder="例如 23370003"
          policy={policy}
          draft={draft}
          disabled={saving}
          onAdd={add}
          onRemove={(field, value) => {
            setDraft((current) => stageRemoval(current, field, value));
            setNotice(null);
          }}
          onUndo={(field, value) => setDraft((current) => undoRemoval(current, field, value))}
        />
        <WhitelistSection
          title="姓名白名单"
          field="names"
          inputLabel="新增姓名"
          placeholder="例如 王五"
          policy={policy}
          draft={draft}
          disabled={saving}
          onAdd={add}
          onRemove={(field, value) => {
            setDraft((current) => stageRemoval(current, field, value));
            setNotice(null);
          }}
          onUndo={(field, value) => setDraft((current) => undoRemoval(current, field, value))}
        />
      </div>

      <footer className="action-bar">
        <p>{counts.total === 0 ? "当前没有未保存的更改" : "更改仅保存在当前页面，保存后才会生效"}</p>
        <div>
          <button
            type="button"
            className="secondary"
            disabled={saving || counts.total === 0}
            onClick={() => {
              setDraft(createEmptyDraft());
              setNotice("已放弃未保存的更改");
              setError(null);
            }}
          >
            放弃更改
          </button>
          <button type="button" disabled={saving || counts.total === 0} onClick={() => void save()}>
            {saving ? "保存中…" : "保存更改"}
          </button>
        </div>
      </footer>
    </main>
  );
}

function PageMessage({
  title,
  detail,
  action,
  busy = false,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className="message-card" aria-live="polite" aria-busy={busy}>
      <p className="eyebrow">BUAA ClassHopper</p>
      <h1>{title}</h1>
      {detail === undefined ? null : <p>{detail}</p>}
      {action}
    </main>
  );
}

function errorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message.length > 0) return caught.message;
  return fallback;
}
