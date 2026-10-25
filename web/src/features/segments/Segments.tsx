import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { Pagination } from "../../components/Pagination";
import { segmentClient, segmentKey } from "./api";
import type { SegmentSummary } from "../../../../src/features/segments/schema";
import "../../platform/resource-theme.css";

export default function Segments() {
  const client = useQueryClient(), toast = useToast(), [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "", rawPage = Number(params.get("page") ?? 1), page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000 ? rawPage : 1;
  const [input, setInput] = useState(search), [deleting, setDeleting] = useState<SegmentSummary | null>(null);
  const list = useQuery({ queryKey: [...segmentKey, "list", page, search], queryFn: ({ signal }) => segmentClient.list(page, search, signal) });
  const mutation = useMutation({ mutationFn: (s: SegmentSummary) => segmentClient.delete(s.id, s.revision), onSuccess: async () => { await client.invalidateQueries({ queryKey: segmentKey }); toast.success("人群已删除"); } });
  return <div className="resource-theme space-y-5">
    <header className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">人群管理</h1><Button asChild><Link to="/admin/segments/new">新建人群</Link></Button></header>
    <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); setParams(input.trim() ? { search: input.trim() } : {}); }}><Input className="max-w-sm" aria-label="查询人群" placeholder="名称或 ID" value={input} onChange={(e) => setInput(e.target.value)} /><Button variant="outline" type="submit">查询</Button></form>
    {mutation.isError && <ErrorNotice error={mutation.error} />}
    {list.isPending ? <Loading /> : list.isError ? <><ErrorNotice error={list.error} /><Button onClick={() => void list.refetch()} variant="outline">重新加载</Button></> : <>
      <Table><TableHeader><TableRow><TableHead>人群</TableHead><TableHead>姓名</TableHead><TableHead>学号</TableHead><TableHead>SSO ID</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {list.data.items.map((s) => <TableRow key={s.id}><TableCell><Link className="font-medium hover:underline" to={`/admin/segments/${s.id}`}>{s.name}</Link></TableCell><TableCell>{s.counts.student_name}</TableCell><TableCell>{s.counts.student_id}</TableCell><TableCell>{s.counts.sso_id}</TableCell><TableCell><div className="flex justify-end gap-2"><Button asChild size="sm" variant="outline"><Link to={`/admin/segments/${s.id}`}>编辑</Link></Button><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => setDeleting(s)}>删除</Button></div></TableCell></TableRow>)}
        {!list.data.items.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">暂无人群。</TableCell></TableRow>}
      </TableBody></Table><Pagination page={page} total={list.data.total} onChange={(p) => setParams({ ...(search ? { search } : {}), page: String(p) })} />
    </>}
    <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent className="resource-theme"><AlertDialogHeader><AlertDialogTitle>删除人群？</AlertDialogTitle><AlertDialogDescription>{deleting?.name} 将被删除，此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleting) mutation.mutate(deleting); setDeleting(null); }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
