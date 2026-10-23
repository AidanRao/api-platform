import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { useDraft } from "../../platform/drafts";
import { AdminApiError, jsonRequest, platformClient } from "../../platform/api";
import { ErrorNotice, useToast } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  pageSchema,
  placementSchema,
  type AdContent,
} from "../../../../src/features/ads/schema";

export const formatNames = {
  banner: "横幅",
  carousel: "轮播",
  card: "图文卡片",
  splash: "开屏",
};
export const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "不限";
export const localTime = (value: string | null) =>
  value
    ? new Date(new Date(value).getTime() + 8 * 3600_000)
        .toISOString()
        .slice(0, 16)
    : "";
export const utcTime = (value: string) =>
  value ? new Date(`${value}:00+08:00`).toISOString() : null;
export const adKey = (
  scope: string | null,
  resource: string,
  ...parts: unknown[]
) =>
  scope === null
    ? ["ads", "platform", resource, ...parts]
    : ["ads", "app", scope, resource, ...parts];
export const adBase = (scope: string | null, resource: string) =>
  `${scope === null ? "" : `/${encodeURIComponent(scope)}`}/ads/${resource}`;
export const pagePath = (scope: string | null, resource: string) =>
  `/admin${adBase(scope, resource)}`;

type Session<T, D> = {
  saved: T | null;
  draft: D;
  baseline: D;
  latest: T | null;
  conflict: boolean;
};
export function useAdForm<T extends { revision: number }, D>(options: {
  scope: string | null;
  resource: string;
  id: string;
  draftKey?: string;
  initial: T | null;
  empty: D;
  fields: (v: T) => D;
  schema: z.ZodType<T>;
  identifier: (v: T) => string;
}) {
  const { scope, resource, id, initial, fields, schema, identifier } = options;
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const base = adBase(scope, resource),
    path = pagePath(scope, resource);
  const changed = (v: Session<T, D>) =>
    JSON.stringify(v.draft) !== JSON.stringify(v.baseline);
  const [session, set, remove] = useDraft<Session<T, D>>(
    scope,
    `ads/${resource}`,
    options.draftKey ?? id,
    () => {
      const draft = initial ? fields(initial) : options.empty;
      return {
        saved: initial,
        draft,
        baseline: draft,
        latest: null,
        conflict: false,
      };
    },
    changed,
  );
  const [error, setError] = useState<unknown>(null);
  const accept = (value: T) => {
    const draft = fields(value);
    set({
      saved: value,
      draft,
      baseline: draft,
      latest: null,
      conflict: false,
    });
    client.setQueryData(
      adKey(scope, resource, "detail", identifier(value)),
      value,
    );
    void client.invalidateQueries({ queryKey: ["ads"] });
  };
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<void>) => {
      setError(null);
      set((v) => v, true);
      try {
        await operation();
      } catch (caught) {
        setError(caught);
        if (
          caught instanceof AdminApiError &&
          caught.status === 409 &&
          session.saved
        ) {
          set((v) => ({ ...v, conflict: true }), true);
          try {
            const latest = await platformClient(
              `${base}/${encodeURIComponent(id)}`,
              schema,
            );
            set((v) => ({ ...v, latest }), true);
          } catch {
            /* Keep input and offer a retry when the latest version cannot be loaded. */
          }
        }
      } finally {
        set((v) => v);
      }
    },
  });
  const save = (body: unknown) =>
    mutation.mutate(async () => {
      const value = await platformClient(
        session.saved ? `${base}/${encodeURIComponent(id)}` : base,
        schema,
        jsonRequest(session.saved ? "PATCH" : "POST", body),
      );
      accept(value);
      toast.success(resource === "creatives" ? "素材已保存并发布" : "已保存");
      if (!session.saved) {
        remove();
        navigate(`${path}/${encodeURIComponent(identifier(value))}`, {
          replace: true,
        });
      }
    });
  const deleteRecord = () =>
    mutation.mutate(async () => {
      await platformClient(
        `${base}/${encodeURIComponent(id)}`,
        z.null(),
        jsonRequest("DELETE", { revision: session.saved!.revision }),
      );
      remove();
      void client.invalidateQueries({ queryKey: ["ads"] });
      toast.success("已删除");
      navigate(path);
    });
  const conflict = session.conflict ? (
    <div className="space-y-3 rounded-lg border p-4" role="alert">
      <p className="font-medium">版本冲突，编辑内容已保留</p>
      {session.latest ? (
        <>
          <details>
            <summary>
              查看服务器最新内容（revision {session.latest.revision}）
            </summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(fields(session.latest), null, 2)}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                set((v) => ({
                  ...v,
                  saved: v.latest,
                  baseline: fields(v.latest!),
                  conflict: false,
                  latest: null,
                }));
                setError(null);
              }}
            >
              保留编辑，采用最新版本号
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                accept(session.latest!);
                setError(null);
              }}
            >
              放弃编辑，加载最新内容
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(async () => {
              const latest = await platformClient(
                `${base}/${encodeURIComponent(id)}`,
                schema,
              );
              set((v) => ({ ...v, latest }), true);
            })
          }
        >
          重新获取最新内容
        </Button>
      )}
    </div>
  ) : null;
  return {
    ...session,
    busy: mutation.isPending,
    changed: changed(session),
    error,
    conflictNotice: conflict,
    path,
    base,
    accept,
    save,
    run: mutation.mutate,
    deleteRecord,
    edit: (patch: Partial<D>) =>
      set((v) => ({ ...v, draft: { ...v.draft, ...patch } })),
    notices: (
      <>
        <ErrorNotice error={error} />
        {conflict}
      </>
    ),
    toast,
  };
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="block">
        {label}
        {children}
      </Label>
    </div>
  );
}
export function Enabled({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-2">
      <Checkbox checked={value} onCheckedChange={(v) => onChange(v === true)} />
      启用
    </Label>
  );
}
export function Schedule({
  startsAt,
  endsAt,
  onChange,
}: {
  startsAt: string | null;
  endsAt: string | null;
  onChange: (v: { startsAt?: string | null; endsAt?: string | null }) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="开始时间（上海时间，可选）">
        <Input
          className="mt-2"
          type="datetime-local"
          value={localTime(startsAt)}
          onChange={(e) => onChange({ startsAt: utcTime(e.target.value) })}
        />
      </Field>
      <Field label="结束时间（上海时间，可选）">
        <Input
          className="mt-2"
          type="datetime-local"
          value={localTime(endsAt)}
          onChange={(e) => onChange({ endsAt: utcTime(e.target.value) })}
        />
      </Field>
    </div>
  );
}
export function EditorHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </header>
  );
}
export function DeleteButton({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={disabled ? "outline" : "destructive"} disabled={disabled}>
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除？</AlertDialogTitle>
          <AlertDialogDescription>
            删除不可恢复。仍被引用的记录不能删除，删除素材会一并删除版本历史，图片文件会保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={disabled ? "outline" : "destructive"}
            disabled={disabled}
            onClick={onDelete}
          >确认删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function ContentPreview({ content }: { content: AdContent }) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
      {content.imageUrl ? (
        <img
          src={content.imageUrl}
          alt={content.title || "广告素材"}
          className="max-h-64 w-full rounded object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">尚未上传图片</p>
      )}
      {content.title && <p className="font-semibold">{content.title}</p>}
      {content.description && (
        <p className="whitespace-pre-wrap text-sm">{content.description}</p>
      )}
      {content.buttonText && (
        <span className="inline-block rounded border px-3 py-1 text-sm">
          {content.buttonText}
        </span>
      )}
    </div>
  );
}
export function PlacementReferences({
  resource,
  id,
}: {
  resource: "campaigns" | "creatives";
  id: string;
}) {
  const [page, setPage] = useState(1);
  const data = useQuery({
    queryKey: adKey(null, resource, id, "placements", page),
    queryFn: ({ signal }) =>
      platformClient(
        `/ads/${resource}/${encodeURIComponent(id)}/placements?page=${page}`,
        pageSchema(placementSchema),
        { signal },
      ),
  });
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">
        关联投放 {data.data ? `（${data.data.total}）` : ""}
      </h2>
      <ErrorNotice error={data.error} />
      {data.isPending ? (
        <p>正在加载引用…</p>
      ) : data.isError ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void data.refetch()}
        >
          重试加载引用
        </Button>
      ) : data.data?.items.length ? (
        <ul className="divide-y rounded-lg border">
          {data.data.items.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap justify-between gap-2 p-3 text-sm"
            >
              <Link
                className="underline"
                to={`/admin/${p.appId}/ads/placements/${p.id}`}
              >
                {p.appId} / {p.slotKey}
              </Link>
              <span>
                {p.enabled ? "启用" : "停用"} · {p.id}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">暂无关联投放</p>
      )}
      {data.data && data.data.total > data.data.pageSize && (
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span>{page}</span>
          <Button
            type="button"
            variant="outline"
            disabled={page * data.data.pageSize >= data.data.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
