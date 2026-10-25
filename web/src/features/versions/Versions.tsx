import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { AppVersion } from "../../../../src/features/versions/schema";
import { useApplication } from "../../platform/AppContext";
import { resourceKey } from "../../platform/query";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Pagination } from "../../components/Pagination";
import { createVersionClient } from "./api";
import "../../platform/resource-theme.css";

const formatSize = (n: number | null) => n === null ? "未设置" : n < 1024 * 1024 ? `${n.toLocaleString()} B` : `${(n / 1024 / 1024).toFixed(2)} MiB`;
export default function Versions() { const app = useApplication(); return <Management key={app.id} />; }
function Management() {
  const app = useApplication(), client = useQueryClient(), toast = useToast();
  const api = useMemo(() => createVersionClient(app.id), [app.id]), root = resourceKey(app.id, "versions");
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? 1), page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000 ? rawPage : 1;
  const [deleting, setDeleting] = useState<AppVersion | null>(null);
  const settings = useQuery({ queryKey: [...root, "settings"], queryFn: () => api.settings() });
  const versions = useQuery({ queryKey: [...root, "list", page], queryFn: ({ signal }) => api.list(page, 20, signal) });
  const mutation = useMutation({ mutationFn: (version: AppVersion) => api.delete(version.version, version.revision), onSuccess: async () => { await client.invalidateQueries({ queryKey: root }); toast.success("版本已删除"); } });
  return <div className="resource-theme space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-semibold">版本管理</h1><Button asChild><Link to={`/admin/${app.id}/versions/new`}>新建版本</Link></Button></header>
    {settings.isError && <ErrorNotice error={settings.error} />}
    {mutation.isError && <div className="space-y-2"><ErrorNotice error={mutation.error} /><Button size="sm" variant="outline" onClick={() => { void client.invalidateQueries({ queryKey: root }); mutation.reset(); }}>刷新后重新操作</Button></div>}
    {versions.isPending ? <Loading /> : versions.isError ? <><ErrorNotice error={versions.error} /><Button onClick={() => void versions.refetch()} variant="outline">重新加载</Button></> : <>
      <Table><TableHeader><TableRow><TableHead>版本</TableHead><TableHead>发布类型</TableHead><TableHead>下载信息</TableHead><TableHead>关联人群</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {versions.data.items.map((v) => <TableRow key={v.version}><TableCell><div className="flex items-center gap-2"><Link className="font-medium hover:underline" to={`/admin/${app.id}/versions/${v.version}`}>{v.version}</Link>{settings.data?.latestVersion === v.version && <Badge>最新</Badge>}</div></TableCell>
          <TableCell>{v.releaseType === "full" ? "全量" : "灰度"}</TableCell>
          <TableCell><div className="max-w-64 space-y-1"><p>{formatSize(v.downloadSizeBytes)}</p>{v.downloadUrl ? <a href={v.downloadUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground underline">{v.downloadUrl}</a> : <p className="text-xs text-muted-foreground">无下载地址</p>}</div></TableCell>
          <TableCell>{v.releaseType === "gray" ? `${v.segmentIds.length} 个` : "—"}</TableCell><TableCell><div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="outline" size="sm"><Link to={`/admin/${app.id}/versions/${v.version}`}>编辑</Link></Button>
              <Button variant="outline" size="sm" disabled={mutation.isPending || !settings.data || settings.data.latestVersion === v.version || v.segmentIds.length > 0} title={v.segmentIds.length ? "请先解除人群关联" : undefined} onClick={() => setDeleting(v)}>删除</Button>
          </div></TableCell></TableRow>)}
        {!versions.data.items.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">暂无版本，请先新建版本。</TableCell></TableRow>}
      </TableBody></Table><Pagination page={page} total={versions.data.total} onChange={(next) => setParams({ page: String(next) })} />
    </>}
    <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent className="resource-theme"><AlertDialogHeader><AlertDialogTitle>删除版本 {deleting?.version}？</AlertDialogTitle><AlertDialogDescription>此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { const version = deleting; setDeleting(null); if (version) mutation.mutate(version); }}>确认</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
