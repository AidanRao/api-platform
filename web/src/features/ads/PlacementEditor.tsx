import { EditorActions } from "@/components/ui/editor-actions";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  placementSchema,
  type Placement,
  type PlacementInput,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { useApplication } from "../../platform/AppContext";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampaignPicker, SlotPicker, CreativePicker } from "./PlacementRecordPicker";
import { PlacementField } from "./PlacementField";
import {
  adBase,
  adKey,
  useAdForm,
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
function Editor({ id, initial }: { id: string; initial: Placement | null }) {
  const [selectionError, setSelectionError] = useState<Error | null>(null);
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
        title={form.saved ? "编辑投放" : "新建投放"}
      />
      {form.notices}
      <ErrorNotice error={selectionError} />
      <form
        className="max-w-4xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.draft.campaignId || !form.draft.slotKey || !form.draft.creativeId) {
            setSelectionError(new Error("请选择活动、广告位和素材"));
            return;
          }
          form.save({
            ...form.draft,
            ...(form.saved ? { revision: form.saved.revision } : {}),
          });
        }}
      >
        <fieldset disabled={form.busy} className="space-y-6">
          <CampaignPicker
            value={form.draft.campaignId}
            onChange={(campaignId) => { setSelectionError(null); form.edit({ campaignId }); }}
            disabled={form.busy}
          />
          <SlotPicker
            appId={app.id}
            value={form.draft.slotKey}
            onChange={(slotKey) => { setSelectionError(null); form.edit({ slotKey }); }}
            disabled={form.busy}
          />
          <CreativePicker
            value={form.draft.creativeId}
            onChange={(creativeId) => { setSelectionError(null); form.edit({ creativeId }); }}
            disabled={form.busy}
          />
          <PlacementField label="点击地址（可选）" htmlFor="placement-target-url">
            <Input
              id="placement-target-url"
              maxLength={2048}
              placeholder="https://… 或 buaa-classhopper://…"
              value={form.draft.targetUrl ?? ""}
              onChange={(e) => form.edit({ targetUrl: e.target.value || null })}
            />
          </PlacementField>
          <PlacementField label="优先级" htmlFor="placement-priority">
            <Input
              id="placement-priority"
              required
              type="number"
              min={-1000000}
              max={1000000}
              value={form.draft.priority}
              onChange={(e) => form.edit({ priority: Number(e.target.value) })}
            />
          </PlacementField>
          <PlacementField label="状态">
          <Enabled
            value={form.draft.enabled}
            onChange={(enabled) => form.edit({ enabled })}
          />
          </PlacementField>
          <PlacementField label="投放时间">
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              高级设置
              {(form.draft.startsAt || form.draft.endsAt) && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  已设置投放时间
                </span>
              )}
            </summary>
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                投放时间留空时跟随活动时间。单独设置后，仅在活动与投放时间的交集内展示。
              </p>
              <Schedule {...form.draft} onChange={form.edit} />
            </div>
          </details>
          </PlacementField>
        </fieldset>
        <EditorActions className="pl-28 sm:pl-36 md:pl-40">
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
        </EditorActions>
      </form>
    </div>
  );
}
