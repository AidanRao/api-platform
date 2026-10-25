import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { segmentClient, segmentKey } from "./api";

export function SegmentPicker({ value, onChange, disabled = false }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const prefix = useId();
  const [search, setSearch] = useState("");
  const list = useQuery({ queryKey: [...segmentKey, "options"], queryFn: ({ signal }) => segmentClient.options(signal) });
  const summaries = new Map(list.data?.map((segment) => [segment.id, segment]));
  const term = search.trim().toLocaleLowerCase();
  const options = list.data?.filter((segment) => `${segment.name}\n${segment.id}`.toLocaleLowerCase().includes(term)) ?? [];
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="mb-3 text-sm font-medium">关联人群</legend>
    {value.length > 0 && <ul aria-label="已选人群" className="flex flex-wrap gap-2">{value.map((id) => <li key={id} className="flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-sm"><Link className="truncate hover:underline" to={`/admin/segments/${id}`} target="_blank" rel="noreferrer">{summaries.get(id)?.name ?? id}</Link><button type="button" disabled={disabled} className="shrink-0 text-xs text-muted-foreground hover:text-foreground" aria-label={`移除人群 ${summaries.get(id)?.name ?? id}`} onClick={() => onChange(value.filter((v) => v !== id))}>移除</button></li>)}</ul>}
    <div className="flex flex-wrap items-center gap-3"><Input aria-label="搜索人群" className="max-w-sm" placeholder="按名称或 ID 搜索" value={search} onChange={(e) => setSearch(e.target.value)} /><Button asChild variant="outline" size="sm"><Link target="_blank" rel="noreferrer" to="/admin/segments/new">新建人群</Link></Button></div>
    {list.isPending ? <Loading /> : list.isError ? <><ErrorNotice error={list.error} /><Button type="button" variant="outline" onClick={() => void list.refetch()}>重新加载人群</Button></> : <>
      <ul className="divide-y" aria-label="可选人群">{options.map((s) => <li key={s.id} className="flex items-center gap-3 py-3"><Checkbox id={`${prefix}-${s.id}`} checked={value.includes(s.id)} disabled={disabled || (!value.includes(s.id) && value.length >= 100)} onCheckedChange={(checked) => onChange(checked ? [...value, s.id].sort() : value.filter((v) => v !== s.id))} /><Label className="min-w-0 flex-1" htmlFor={`${prefix}-${s.id}`}><span className="break-words">{s.name}</span><span className="ml-3 text-xs font-normal text-muted-foreground">姓名 {s.counts.student_name}，学号 {s.counts.student_id}，SSO ID {s.counts.sso_id}</span></Label></li>)}</ul>
      {!options.length && <p className="py-4 text-sm text-muted-foreground">暂无符合条件的人群。</p>}
    </>}
  </fieldset>;
}
