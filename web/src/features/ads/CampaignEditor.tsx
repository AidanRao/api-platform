import { EditorActions } from "@/components/ui/editor-actions";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import {
  campaignSchema,
  type Campaign,
  type CampaignInput,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { appsQuery } from "../../platform/query";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  adKey,
  useAdForm,
  Field,
  Enabled,
  Schedule,
  EditorHeader,
  DeleteButton,
  PlacementReferences,
} from "./shared";
const empty: CampaignInput = {
  name: "",
  notes: "",
  enabled: false,
  startsAt: null,
  endsAt: null,
};
const fields = (v: Campaign): CampaignInput => ({
  name: v.name,
  notes: v.notes,
  enabled: v.enabled,
  startsAt: v.startsAt,
  endsAt: v.endsAt,
});
export default function CampaignEditor() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: adKey(null, "campaigns", "detail", id),
    queryFn: () =>
      platformClient(
        `/ads/campaigns/${encodeURIComponent(id!)}`,
        campaignSchema,
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
    <Editor key={id ?? "new"} id={id ?? "new"} initial={query.data ?? null} />
  );
}
function Editor({ id, initial }: { id: string; initial: Campaign | null }) {
  const form = useAdForm({
    scope: null,
    resource: "campaigns",
    id,
    initial,
    empty,
    fields,
    schema: campaignSchema,
    identifier: (v) => v.id,
  });
  const apps = useQuery(appsQuery);
  return (
    <div className="space-y-6">
      <EditorHeader
        title={form.saved ? "编辑活动" : "新建活动"}
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
          <Field label="活动名称">
            <Input
              className="mt-2"
              value={form.draft.name}
              maxLength={200}
              required
              onChange={(e) => form.edit({ name: e.target.value })}
            />
          </Field>
          <Field label="备注">
            <Textarea
              className="mt-2"
              value={form.draft.notes}
              maxLength={2000}
              onChange={(e) => form.edit({ notes: e.target.value })}
            />
          </Field>
          <Schedule {...form.draft} onChange={form.edit} />
          <Enabled
            value={form.draft.enabled}
            onChange={(enabled) => form.edit({ enabled })}
          />
        </fieldset>
        <EditorActions>
          <Button
            disabled={
              form.busy || form.conflict || (!!form.saved && !form.changed)
            }
          >
            保存活动
          </Button>
          {form.saved && (
            <DeleteButton
              disabled={form.busy || form.conflict}
              onDelete={form.deleteRecord}
            />
          )}
        </EditorActions>
      </form>
      {form.saved && (
        <>
          <section className="space-y-3">
            <h2 className="font-semibold">添加投放</h2>
            <div className="flex flex-wrap gap-2">
              {apps.data?.items.map((app) => (
                <Button key={app.id} asChild variant="outline">
                  <Link
                    to={`/admin/${app.id}/ads/placements/new?campaignId=${encodeURIComponent(id)}`}
                  >
                    {app.name}
                  </Link>
                </Button>
              ))}
            </div>
          </section>
          <PlacementReferences resource="campaigns" id={id} />
        </>
      )}
    </div>
  );
}
