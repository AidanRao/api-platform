import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { z } from "zod";
import {
  placementSchema,
  campaignSchema,
  creativeSchema,
  slotSchema,
  pageSchema,
  type Placement,
  type PlacementInput,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { useApplication } from "../../platform/AppContext";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adBase,
  adKey,
  useAdForm,
  Field,
  Enabled,
  Schedule,
  EditorHeader,
  DeleteButton,
} from "./shared";
const empty: PlacementInput = {
  campaignId: "",
  creativeId: "",
  slotKey: "",
  targetUrl: null,
  priority: 0,
  enabled: false,
  startsAt: null,
  endsAt: null,
};
const fields = (v: Placement): PlacementInput => ({
  campaignId: v.campaignId,
  creativeId: v.creativeId,
  slotKey: v.slotKey,
  targetUrl: v.targetUrl,
  priority: v.priority,
  enabled: v.enabled,
  startsAt: v.startsAt,
  endsAt: v.endsAt,
});
export default function PlacementEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const app = useApplication();
  const query = useQuery({
    queryKey: adKey(app.id, "placements", "detail", id),
    queryFn: () =>
      platformClient(
        `${adBase(app.id, "placements")}/${encodeURIComponent(id!)}`,
        placementSchema,
      ),
    enabled: !!id,
  });
  if (id && query.isPending) return <Loading />;
  if (id && query.isError)
    return (
      <>
        <ErrorNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新加载</Button>
      </>
    );
  return (
    <Editor
      key={`${app.id}/${id ?? `new:${campaignId}`}`}
      id={id ?? "new"}
      initial={query.data ?? null}
    />
  );
}
// Paginated selectors keep large libraries usable without fetching every page or silently hiding records.
function RecordSelect<T>({
  label,
  scope,
  resource,
  schema,
  value,
  onChange,
  keyOf,
  labelOf,
}: {
  label: string;
  scope: string | null;
  resource: string;
  schema: z.ZodType<T>;
  value: string;
  onChange: (v: string) => void;
  keyOf: (v: T) => string;
  labelOf: (v: T) => string;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: adKey(scope, resource, "selector", page),
    queryFn: ({ signal }) =>
      platformClient(
        `${adBase(scope, resource)}?page=${page}&pageSize=20`,
        pageSchema(schema),
        { signal },
      ),
  });
  return (
    <div className="space-y-2">
      <Field label={label}>
        <select
          className="mt-2 block w-full rounded-md border bg-background p-2"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">请选择</option>
          {value && !query.data?.items.some((i) => keyOf(i) === value) && (
            <option value={value}>{value}</option>
          )}
          {query.data?.items.map((item) => (
            <option value={keyOf(item)} key={keyOf(item)}>
              {labelOf(item)}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={query.error} />
      {query.isError && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          重试加载{label}
        </Button>
      )}
      {query.isPending && <p className="text-sm">正在加载…</p>}
      {query.data && query.data.total > 20 && (
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一批
          </Button>
          <span>
            {page} / {Math.ceil(query.data.total / 20)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page * 20 >= query.data.total}
            onClick={() => setPage(page + 1)}
          >
            下一批
          </Button>
        </div>
      )}
    </div>
  );
}
function Editor({ id, initial }: { id: string; initial: Placement | null }) {
  const app = useApplication();
  const [params] = useSearchParams();
  const form = useAdForm({
    scope: app.id,
    resource: "placements",
    id,
    draftKey: id === "new" ? `new:${params.get("campaignId") ?? ""}` : id,
    initial,
    empty: { ...empty, campaignId: params.get("campaignId") ?? "" },
    fields,
    schema: placementSchema,
    identifier: (v) => v.id,
  });
  return (
    <div className="space-y-6">
      <EditorHeader
        path={form.path}
        title={form.saved ? "编辑投放" : "新建投放"}
      />
      {form.notices}
      <form
        className="max-w-3xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.save({
            ...form.draft,
            ...(form.saved ? { revision: form.saved.revision } : {}),
          });
        }}
      >
        <fieldset disabled={form.busy} className="space-y-5">
          <RecordSelect
            label="活动"
            scope={null}
            resource="campaigns"
            schema={campaignSchema}
            value={form.draft.campaignId}
            onChange={(campaignId) => form.edit({ campaignId })}
            keyOf={(v) => v.id}
            labelOf={(v) => `${v.name}${v.enabled ? "" : "（停用）"}`}
          />
          <RecordSelect
            label="广告位"
            scope={app.id}
            resource="slots"
            schema={slotSchema}
            value={form.draft.slotKey}
            onChange={(slotKey) => form.edit({ slotKey })}
            keyOf={(v) => v.slotKey}
            labelOf={(v) => `${v.name} · ${v.slotKey}`}
          />
          <RecordSelect
            label="素材"
            scope={null}
            resource="creatives"
            schema={creativeSchema}
            value={form.draft.creativeId}
            onChange={(creativeId) => form.edit({ creativeId })}
            keyOf={(v) => v.id}
            labelOf={(v) =>
              `${v.name} · ${v.type === "card" ? "卡片" : "图片"} · ${v.publishedVersion ? `v${v.publishedVersion}` : "未发布"}`
            }
          />
          <Field label="点击地址（可选）">
            <Input
              className="mt-2"
              maxLength={2048}
              placeholder="https://… 或 buaa-classhopper://…"
              value={form.draft.targetUrl ?? ""}
              onChange={(e) => form.edit({ targetUrl: e.target.value || null })}
            />
          </Field>
          <Field label="优先级">
            <Input
              className="mt-2"
              required
              type="number"
              min={-1000000}
              max={1000000}
              value={form.draft.priority}
              onChange={(e) => form.edit({ priority: Number(e.target.value) })}
            />
          </Field>
          <Schedule {...form.draft} onChange={form.edit} />
          <Enabled
            value={form.draft.enabled}
            onChange={(enabled) => form.edit({ enabled })}
          />
        </fieldset>
        <div className="flex gap-3">
          <Button
            disabled={
              form.busy || form.conflict || (!!form.saved && !form.changed)
            }
          >
            保存投放
          </Button>
          {form.saved && (
            <DeleteButton
              disabled={form.busy || form.conflict}
              onDelete={form.deleteRecord}
            />
          )}
        </div>
      </form>
    </div>
  );
}
