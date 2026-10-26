import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import type { SegmentSummary } from "../../../../src/features/segments/schema";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { segmentClient, segmentKey } from "./api";
import "../../platform/resource-theme.css";

export function SegmentPicker({ value, onChange, disabled = false }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const list = useQuery({ queryKey: [...segmentKey, "options"], queryFn: ({ signal }) => segmentClient.options(signal), enabled: open && !disabled });
  const summaries = new Map(list.data?.map((segment) => [segment.id, segment]));
  const term = search.trim().toLocaleLowerCase();
  const options = list.data?.filter((segment) => `${segment.name}\n${segment.id}`.toLocaleLowerCase().includes(term)) ?? [];
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="mb-3 text-sm font-medium">关联人群</legend>
    <Sheet open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (next) setSearch(""); }}>
      <div className="flex flex-wrap items-center gap-2">
        {value.length > 0 && <ul aria-label="已选人群" className="flex max-w-full flex-wrap gap-2">{value.map((id) => <SelectedSegment key={id} id={id} summary={summaries.get(id)} disabled={disabled} onRemove={() => onChange(value.filter((v) => v !== id))} />)}</ul>}
        <SheetTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled}><Plus aria-hidden="true" />添加人群</Button></SheetTrigger>
      </div>
      <SheetContent aria-describedby={undefined} showCloseButton={false} className="resource-theme w-full gap-0 shadow-none transition-none data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-lg" overlayClassName="resource-theme bg-foreground/40 data-[state=open]:animate-none data-[state=closed]:animate-none">
        <SheetHeader className="relative shrink-0 border-b p-5 pr-16">
          <SheetTitle>选择人群</SheetTitle>
          <SheetClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="关闭人群选择" className="absolute right-4 top-4"><X aria-hidden="true" /></Button></SheetClose>
        </SheetHeader>
        <div className="flex shrink-0 items-center gap-3 p-5">
          <Input aria-label="搜索人群" placeholder="按名称或 ID 搜索" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button asChild variant="outline" size="sm"><Link target="_blank" rel="noreferrer" to="/admin/segments/new">新建人群</Link></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {list.isPending ? <Loading /> : list.isError ? <div className="space-y-3"><ErrorNotice error={list.error} /><Button type="button" variant="outline" onClick={() => void list.refetch()}>重新加载人群</Button></div> : <>
            <ul className="divide-y" aria-label="可选人群">{options.map((s) => <li key={s.id} className="flex items-center gap-3">
              <Checkbox id={`${prefix}-${s.id}`} checked={value.includes(s.id)} disabled={disabled || (!value.includes(s.id) && value.length >= 100)} onCheckedChange={(checked) => onChange(checked === true ? [...value, s.id].sort() : value.filter((v) => v !== s.id))} />
              <Label className="min-w-0 flex-1 flex-col items-start gap-1 py-4" htmlFor={`${prefix}-${s.id}`}><span className="break-words">{s.name}</span><span className="text-xs font-normal text-muted-foreground">姓名 {s.counts.student_name}，学号 {s.counts.student_id}，SSO ID {s.counts.sso_id}</span></Label>
            </li>)}</ul>
            {!options.length && <p className="py-8 text-center text-sm text-muted-foreground">暂无符合条件的人群。</p>}
          </>}
        </div>
        <SheetFooter className="shrink-0 flex-row items-center justify-between border-t p-5">
          <span className="text-xs text-muted-foreground">已选 {value.length} / 100</span>
          <SheetClose asChild><Button type="button">完成</Button></SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </fieldset>;
}

function SelectedSegment({ id, summary, disabled, onRemove }: { id: string; summary?: SegmentSummary; disabled: boolean; onRemove: () => void }) {
  const selected = useQuery({ queryKey: [...segmentKey, "summary", id], queryFn: ({ signal }) => segmentClient.summary(id, signal), enabled: summary === undefined });
  const name = summary?.name ?? selected.data?.name ?? id;
  return <li className="flex max-w-full items-center gap-1 rounded-md border py-1 pl-2 pr-1 text-sm">
    <Link className="min-w-0 truncate hover:underline" title={id} to={`/admin/segments/${id}`} target="_blank" rel="noreferrer">{name}</Link>
    <button type="button" disabled={disabled} className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" aria-label={`移除人群 ${name}`} onClick={onRemove}><X aria-hidden="true" className="size-3.5" /></button>
  </li>;
}
