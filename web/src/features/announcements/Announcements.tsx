import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { createAnnouncementClient } from "./api";
import { useApplication } from "../../platform/AppContext";
import { resourceKey } from "../../platform/query";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusNames, formatTime } from "./presentation";

export default function Announcements() {
  const app = useApplication();
  const api = useMemo(() => createAnnouncementClient(app.id), [app.id]);
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000 ? rawPage : 1;
  const rawStatus = params.get("status") ?? "";
  const status = Object.hasOwn(statusNames, rawStatus) ? rawStatus : "";
  const tag = params.get("tag")?.trim() ?? "";
  const list = useQuery({ queryKey: [...resourceKey(app.id, "announcements"), "list", { page, status, tag }], queryFn: ({ signal }) => api.list(page, status, signal, tag) });
  const tags = useQuery({ queryKey: [...resourceKey(app.id, "announcements"), "tags", status], queryFn: ({ signal }) => api.tags(status, signal) });
  const selectTag = (value: string) => setParams({ page: "1", ...(status ? { status } : {}), ...(value ? { tag: value } : {}) });
  const path = `/admin/${app.id}/announcements`;
  const updatePage = (next: number) => setParams({ page: String(next), ...(status ? { status } : {}), ...(tag ? { tag } : {}) });
  useEffect(() => {
    if (list.data && page > 1 && list.data.items.length === 0) setParams({ page: String(Math.max(1, Math.ceil(list.data.total / 20))), ...(status ? { status } : {}), ...(tag ? { tag } : {}) }, { replace: true });
  }, [list.data, page, status, tag, setParams]);
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">公告管理</h1><Button asChild><Link to={`${path}/new`}>新增公告</Link></Button></div>
    <div className="flex flex-wrap items-center gap-3"><Select value={status || "all"} onValueChange={(value) => setParams({ page: "1", ...(value === "all" ? {} : { status: value }), ...(tag ? { tag } : {}) })}>
      <SelectTrigger aria-label="发布状态" className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusNames).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
    </Select><Button variant="outline" disabled={list.isFetching} onClick={() => { void list.refetch(); void tags.refetch(); }}>刷新列表</Button></div>
    <div className="space-y-3" aria-label="标签筛选">
      <div className="flex flex-wrap gap-2">
        <Button variant={tag ? "outline" : "default"} aria-pressed={!tag} onClick={() => selectTag("")}>全部</Button>
        {tags.data?.items.map((item) => <Button key={item.tag} variant={tag === item.tag ? "default" : "outline"} aria-pressed={tag === item.tag} onClick={() => selectTag(item.tag)}>{item.tag}（{item.count}）</Button>)}
        {tag && !tags.data?.items.some((item) => item.tag === tag) && <Button aria-pressed="true" onClick={() => selectTag("")}>{tag}（当前筛选）</Button>}
      </div>
      {tags.isPending && <p role="status" className="text-sm text-muted-foreground">正在加载标签…</p>}
      {tags.isError && <><ErrorNotice error={tags.error} /><Button variant="outline" onClick={() => void tags.refetch()}>重试加载标签</Button></>}
    </div>
    {list.isPending ? <Loading /> : list.isError ? <ErrorNotice error={list.error} /> : <>
      <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>公告标题</TableHead><TableHead>标签</TableHead><TableHead>状态</TableHead><TableHead>首次发布时间（上海时间）</TableHead></TableRow></TableHeader><TableBody>
        {list.data.items.map((item) => <TableRow key={item.id}><TableCell><Link className="font-medium underline-offset-4 hover:underline" to={`${path}/${item.id}`}>{item.title}</Link>{item.isPinned && <Badge variant="secondary" className="ml-2">置顶</Badge>}</TableCell><TableCell><div className="flex flex-wrap gap-1">{item.tags.map((tag) => <Badge variant="secondary" key={tag}>{tag}</Badge>)}</div></TableCell><TableCell><Badge variant="outline">{statusNames[item.status]}</Badge></TableCell><TableCell className="text-muted-foreground">{formatTime(item.publishedAt)}</TableCell></TableRow>)}
        {list.data.items.length === 0 && <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">暂无公告</TableCell></TableRow>}
      </TableBody></Table></div>
      <div className="flex flex-wrap items-center justify-end gap-3"><span className="text-sm text-muted-foreground">第 {page} 页 · 共 {list.data.total} 条</span><Button variant="outline" disabled={page <= 1} onClick={() => updatePage(page - 1)}>上一页</Button><Button variant="outline" disabled={page * 20 >= list.data.total} onClick={() => updatePage(page + 1)}>下一页</Button></div>
    </>}
  </div>;
}
