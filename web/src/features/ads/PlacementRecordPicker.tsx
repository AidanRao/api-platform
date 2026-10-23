import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { z } from "zod";
import {
  campaignSchema, creativeSchema, slotSchema, pageSchema,
  type Campaign, type Creative, type AdSlot,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { ErrorNotice } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetTrigger, SheetClose, SheetContent,
  SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { adBase, adKey, formatNames, time } from "./shared";
import { PlacementField } from "./PlacementField";

type PickerValue = {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
};

function RecordPicker<T extends { name: string }>({
  label, scope, resource, schema, keyOf, renderRecord,
  value, onChange, disabled,
}: PickerValue & {
  label: string;
  scope: string | null;
  resource: string;
  schema: z.ZodType<T>;
  keyOf: (record: T) => string;
  renderRecord: (record: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const rich = resource === "creatives";
  const client = useQueryClient();
  const selected = useQuery({
    queryKey: adKey(scope, resource, "detail", value),
    queryFn: ({ signal }) => platformClient(
      `${adBase(scope, resource)}/${encodeURIComponent(value)}`, schema, { signal },
    ),
    enabled: !!value,
  });
  const records = useQuery({
    queryKey: adKey(scope, resource, "selector", page),
    queryFn: ({ signal }) => platformClient(
      `${adBase(scope, resource)}?page=${page}&pageSize=20`, pageSchema(schema), { signal },
    ),
    enabled: open,
  });

  return (
    <PlacementField label={label}>
      <Sheet open={open} onOpenChange={setOpen}>
        <div className={cn("flex gap-3", rich ? "flex-col items-start" : "items-start justify-between")}>
        {value ? (
          <div role="group" aria-label={`已选${label}`} className={cn("min-w-0 flex-1", rich ? "w-full rounded-lg border bg-background p-4" : "py-1.5")}>
            {selected.data ? renderRecord(selected.data) : (
              <div className="space-y-2">
                <p className="break-all font-mono text-xs text-muted-foreground">{value}</p>
                {selected.isPending && <p role="status" className="text-sm text-muted-foreground">正在加载{label}详情…</p>}
              </div>
            )}
            {selected.isError && (
              <div className="mt-3 space-y-2">
                <ErrorNotice error={selected.error} />
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void selected.refetch()}>
                  重试加载{label}
                </Button>
              </div>
            )}
          </div>
        ) : null}
          <SheetTrigger asChild>
            <Button type="button" size="sm" variant="outline" disabled={disabled}>
              {value ? `更换${label}` : `选择${label}`}
            </Button>
          </SheetTrigger>
        </div>
        <SheetContent className="w-full gap-0 sm:max-w-2xl" showCloseButton={false}>
          <SheetHeader className="relative shrink-0 border-b p-5 pr-16">
            <SheetTitle>选择{label}</SheetTitle>
            <SheetDescription>点击选择{label}，关闭抽屉保留原选择。</SheetDescription>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`关闭${label}选择`} className="absolute right-4 top-4">
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", rich ? "space-y-3" : "divide-y")}>
            {records.isPending && <p role="status" className="text-sm text-muted-foreground">正在加载{label}…</p>}
            {records.isError && (
              <>
                <ErrorNotice error={records.error} />
                <Button type="button" variant="outline" onClick={() => void records.refetch()}>重试加载{label}</Button>
              </>
            )}
            {records.data?.items.map((record) => {
              const key = keyOf(record);
              const checked = key === value;
              return (
                <button
                  type="button"
                  key={key}
                  aria-label={`选择${label}：${record.name}（${key}）`}
                  aria-pressed={checked}
                  disabled={disabled}
                  className={cn(
                    "block w-full bg-background p-4 text-left outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                    rich && "rounded-lg border hover:border-primary/50",
                    checked && (rich ? "border-primary bg-primary/5" : "bg-muted/40"),
                  )}
                  onClick={() => {
                    client.setQueryData(adKey(scope, resource, "detail", key), record);
                    onChange(key);
                    setOpen(false);
                  }}
                >
                  {renderRecord(record)}
                  {!rich && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{key}</p>}
                  {checked && <p className="mt-2 text-xs font-medium text-primary">已选择</p>}
                </button>
              );
            })}
            {records.data?.items.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">暂无{label}</p>}
          </div>
          <SheetFooter className="shrink-0 flex-row items-center justify-between border-t p-4">
            <p className="text-xs text-muted-foreground">共 {records.data?.total ?? 0} 条 · 第 {page} 页</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={disabled || records.isFetching || page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <Button type="button" size="sm" variant="outline" disabled={disabled || !records.data || records.isFetching || page * 20 >= records.data.total} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PlacementField>
  );
}

function RecordMeta({ id, updatedAt }: { id: string; updatedAt: string }) {
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p className="break-all font-mono">{id}</p>
    <p>更新于 {time(updatedAt)}（上海）</p>
  </div>;
}

function CampaignSummary(record: Campaign) {
  return <div className="space-y-1 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="break-words font-medium">{record.name}</p></div>
    <p className="text-xs text-muted-foreground">{record.startsAt || record.endsAt ? `${time(record.startsAt)} → ${time(record.endsAt)}` : "不限时间"}</p>
  </div>;
}

function SlotSummary(record: AdSlot) {
  return <div className="space-y-1 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="break-words font-medium">{record.name}</p></div>
    <p className="text-xs text-muted-foreground">{formatNames[record.format]} · 最多 {record.maxItems} 条</p>
  </div>;
}

function CreativeImage({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 sm:w-40">
      {url && !failed ? (
        <img src={url} alt={`${name}预览`} className="absolute inset-0 size-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <span className="text-xs text-muted-foreground">暂无图片</span>
      )}
    </div>
  );
}

function CreativeSummary(record: Creative) {
  const content = record.published?.content ?? record.draft;
  const changed = record.published && JSON.stringify(record.draft) !== JSON.stringify(record.published.content);
  return <div className="flex flex-col gap-4 sm:flex-row">
    <CreativeImage key={content.imageUrl ?? "empty"} url={content.imageUrl} name={record.name} />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="break-words font-medium">{record.name}</p>
      <div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{record.type === "card" ? "图文卡片" : "图片"}</Badge><Badge variant="outline">{record.publishedVersion ? `已发布 v${record.publishedVersion}` : "未发布"}</Badge>{changed && <Badge variant="outline">有未发布更改</Badge>}</div>
      {content.title && <p className="break-words text-sm font-medium">{content.title}</p>}
      {content.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{content.description}</p>}
      {content.buttonText && <Badge variant="outline">按钮：{content.buttonText}</Badge>}
      {!record.published && <p className="text-xs text-muted-foreground">请先保存此素材，再启用投放。</p>}
      {changed && <p className="text-xs text-muted-foreground">预览为当前发布内容，保存素材后将更新投放。</p>}
      <RecordMeta id={record.id} updatedAt={record.updatedAt} />
    </div>
  </div>;
}

export function CampaignPicker(props: PickerValue) {
  return <RecordPicker {...props} label="活动" scope={null} resource="campaigns" schema={campaignSchema} keyOf={(record) => record.id} renderRecord={CampaignSummary} />;
}
export function SlotPicker({ appId, ...props }: PickerValue & { appId: string }) {
  return <RecordPicker {...props} label="广告位" scope={appId} resource="slots" schema={slotSchema} keyOf={(record) => record.slotKey} renderRecord={SlotSummary} />;
}
export function CreativePicker(props: PickerValue) {
  return <RecordPicker {...props} label="素材" scope={null} resource="creatives" schema={creativeSchema} keyOf={(record) => record.id} renderRecord={CreativeSummary} />;
}
