import { EditorActions } from "@/components/ui/editor-actions";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  creativeSchema,
  versionSchema,
  pageSchema,
  type Creative,
  type CreativeInput,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { uploadImage } from "../../platform/media";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
import { Textarea } from "@/components/ui/textarea";
import {
  adKey,
  useAdForm,
  Field,
  EditorHeader,
  DeleteButton,
  ContentPreview,
  PlacementReferences,
  time,
} from "./shared";
const empty: CreativeInput = {
  name: "",
  type: "image",
  draft: { imageUrl: null, title: "", description: "", buttonText: "" },
};
const fields = (v: Creative): CreativeInput => ({
  name: v.name,
  type: v.type,
  draft: v.draft,
});
export default function CreativeEditor() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: adKey(null, "creatives", "detail", id),
    queryFn: () =>
      platformClient(
        `/ads/creatives/${encodeURIComponent(id!)}`,
        creativeSchema,
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
function Editor({ id, initial }: { id: string; initial: Creative | null }) {
  const form = useAdForm({
    scope: null,
    resource: "creatives",
    id,
    initial,
    empty,
    fields,
    schema: creativeSchema,
    identifier: (v) => v.id,
  });
  const needsPublication = !!form.saved && (
    !form.saved.published || JSON.stringify(form.saved.draft) !== JSON.stringify(form.saved.published.content)
  );
  const [historyPage, setHistoryPage] = useState(1);
  const history = useQuery({
    queryKey: adKey(null, "creatives", id, "versions", historyPage),
    queryFn: ({ signal }) =>
      platformClient(
        `/ads/creatives/${id}/versions?page=${historyPage}&pageSize=10`,
        pageSchema(versionSchema),
        { signal },
      ),
    enabled: !!form.saved,
  });
  const editContent = (patch: Partial<CreativeInput["draft"]>) =>
    form.edit({ draft: { ...form.draft.draft, ...patch } });
  return (
    <div className="space-y-6">
      <EditorHeader
        title={form.saved ? "编辑素材" : "新建素材"}
      >
        <p className="text-sm text-muted-foreground">
          {form.saved?.publishedVersion
            ? `当前发布版本 v${form.saved.publishedVersion} · 保存后立即发布`
            : "保存后立即发布，所有引用此素材的投放将使用保存后的内容"}
        </p>
      </EditorHeader>
      {form.notices}
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const { type, ...editable } = form.draft;
          form.save(
            form.saved
              ? { ...editable, revision: form.saved.revision }
              : form.draft,
          );
        }}
      >
        <fieldset disabled={form.busy} className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <Field label="素材名称">
              <Input
                className="mt-2"
                required
                maxLength={200}
                value={form.draft.name}
                onChange={(e) => form.edit({ name: e.target.value })}
              />
            </Field>
            <div className="space-y-2">
              <SegmentedChoice<CreativeInput["type"]>
                label="素材类型"
                disabled={!!form.saved}
                value={form.draft.type}
                options={[
                  { value: "image", label: "图片" },
                  { value: "card", label: "图文卡片" },
                ]}
                onChange={(type) => form.edit({ type })}
              />
              <p className="text-xs text-muted-foreground">
                图片适用于横幅、轮播和开屏。
              </p>
            </div>
            <Field label="素材图片">
              <Input
                className="mt-2"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  form.run(async () => {
                    if (
                      file.size > 5 * 1024 * 1024 ||
                      ![
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "image/gif",
                      ].includes(file.type)
                    )
                      throw new Error(
                        "请选择不超过 5 MiB 的 JPEG、PNG、WebP 或 GIF 图片",
                      );
                    const result = await uploadImage(file);
                    editContent({ imageUrl: result.url });
                    form.toast.info("图片已上传，请保存素材");
                  });
                }}
              />
            </Field>
            {form.draft.draft.imageUrl && (
              <Button
                type="button"
                variant="outline"
                onClick={() => editContent({ imageUrl: null })}
              >
                移除图片
              </Button>
            )}
            <Field label="标题">
              <Input
                className="mt-2"
                maxLength={200}
                value={form.draft.draft.title}
                onChange={(e) => editContent({ title: e.target.value })}
              />
            </Field>
            <Field label="描述">
              <Textarea
                className="mt-2"
                maxLength={2000}
                value={form.draft.draft.description}
                onChange={(e) => editContent({ description: e.target.value })}
              />
            </Field>
            <Field label="按钮文案">
              <Input
                className="mt-2"
                maxLength={50}
                value={form.draft.draft.buttonText}
                onChange={(e) => editContent({ buttonText: e.target.value })}
              />
            </Field>
          </div>
          <div className="space-y-3">
            <h2 className="font-semibold">素材预览</h2>
            <ContentPreview content={form.draft.draft} />
            {form.saved?.published && (
              <>
                <h2 className="pt-4 font-semibold">
                  当前发布内容 · v{form.saved.publishedVersion}
                </h2>
                <ContentPreview content={form.saved.published.content} />
              </>
            )}
          </div>
        </fieldset>
        <EditorActions>
          <Button
            disabled={
              form.busy || form.conflict || (!!form.saved && !form.changed && !needsPublication)
            }
          >
            保存素材
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
          <PlacementReferences resource="creatives" id={id} />
          <section className="space-y-3">
            <h2 className="font-semibold">发布历史</h2>
            <ErrorNotice error={history.error} />
            {history.isError && (
              <Button variant="outline" onClick={() => void history.refetch()}>
                重新加载历史
              </Button>
            )}
            {history.data?.items.map((v) => (
              <details key={v.version} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">
                  v{v.version} · {time(v.publishedAt)}
                </summary>
                <div className="mt-3">
                  <ContentPreview content={v.content} />
                </div>
              </details>
            ))}
            {history.data?.total === 0 && (
              <p className="text-sm text-muted-foreground">尚无发布记录</p>
            )}
            {history.data && history.data.total > 10 && (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage(historyPage - 1)}
                >
                  上一页
                </Button>
                <span>{historyPage}</span>
                <Button
                  variant="outline"
                  disabled={historyPage * 10 >= history.data.total}
                  onClick={() => setHistoryPage(historyPage + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
