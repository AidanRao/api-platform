import { EditorActions } from "@/components/ui/editor-actions";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  slotSchema,
  type AdSlot,
  type SlotInput,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { useApplication } from "../../platform/AppContext";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
import {
  adBase,
  adKey,
  useAdForm,
  Field,
  EditorHeader,
  DeleteButton,
  formatNames,
} from "./shared";
const empty: SlotInput = {
  slotKey: "",
  name: "",
  format: "banner",
  maxItems: 1,
};
const fields = (v: AdSlot): SlotInput => ({
  slotKey: v.slotKey,
  name: v.name,
  format: v.format,
  maxItems: v.maxItems,
});
export default function SlotEditor() {
  const { id } = useParams();
  const app = useApplication();
  const query = useQuery({
    queryKey: adKey(app.id, "slots", "detail", id),
    queryFn: () =>
      platformClient(
        `${adBase(app.id, "slots")}/${encodeURIComponent(id!)}`,
        slotSchema,
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
      key={`${app.id}/${id ?? "new"}`}
      id={id ?? "new"}
      initial={query.data ?? null}
    />
  );
}
function Editor({ id, initial }: { id: string; initial: AdSlot | null }) {
  const app = useApplication();
  const form = useAdForm({
    scope: app.id,
    resource: "slots",
    id,
    initial,
    empty,
    fields,
    schema: slotSchema,
    identifier: (v) => v.slotKey,
  });
  return (
    <div className="space-y-6">
      <EditorHeader
        title={form.saved ? "编辑广告位" : "新建广告位"}
      />
      {form.notices}
      <form
        className="max-w-3xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const { slotKey, format, ...editable } = form.draft;
          form.save(
            form.saved
              ? { ...editable, revision: form.saved.revision }
              : form.draft,
          );
        }}
      >
        <fieldset disabled={form.busy} className="space-y-5">
          <Field label="广告位名称">
            <Input
              className="mt-2"
              required
              maxLength={200}
              value={form.draft.name}
              onChange={(e) => form.edit({ name: e.target.value })}
            />
          </Field>
          <div className="space-y-2">
            <Field label="广告位标识">
              <Input
                className="mt-2"
                required
                maxLength={100}
                disabled={!!form.saved}
                value={form.draft.slotKey}
                placeholder="announcement_top_banner"
                aria-describedby="slot-key-hint"
                onChange={(e) => form.edit({ slotKey: e.target.value })}
              />
            </Field>
            <p id="slot-key-hint" className="text-xs text-muted-foreground">
              支持小写字母、数字，可用短横线（-）或下划线（_）分隔，最长 100 字符。
            </p>
          </div>
          <SegmentedChoice
            label="展示形式"
            disabled={!!form.saved}
            value={form.draft.format}
            options={Object.entries(formatNames).map(([value, label]) => ({
              value: value as SlotInput["format"],
              label,
            }))}
            onChange={(format) =>
              form.edit({ format, maxItems: format === "carousel" ? 5 : 1 })
            }
          />
          {form.draft.format === "carousel" && (
            <Field label="最多返回条数">
              <Input
                className="mt-2"
                type="number"
                min={1}
                max={10}
                required
                value={form.draft.maxItems}
                onChange={(e) =>
                  form.edit({ maxItems: Number(e.target.value) })
                }
              />
            </Field>
          )}
        </fieldset>
        <EditorActions>
          <Button
            disabled={
              form.busy || form.conflict || (!!form.saved && !form.changed)
            }
          >
            保存广告位
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
