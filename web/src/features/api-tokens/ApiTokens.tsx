import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import { useApplication } from "../../platform/AppContext";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { resourceKey } from "../../platform/query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createApiTokenClient, type ApiToken } from "./api";
import { formatTime } from "./presentation";

function tokenStatus(token: ApiToken) {
  if (token.revokedAt) return "已撤销";
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) return "已过期";
  return "有效";
}

export default function ApiTokens() {
  const app = useApplication();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useMemo(() => createApiTokenClient(app.id), [app.id]);
  const list = useQuery({
    queryKey: [...resourceKey(app.id, "api-tokens"), "list"],
    queryFn: ({ signal }) => api.list(signal),
  });
  const catalog = useQuery({
    queryKey: [...resourceKey(app.id, "api-tokens"), "permissions"],
    queryFn: ({ signal }) => api.permissions(signal),
  });
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{ name: string; value: string } | null>(null);
  const filtered = list.data?.items.filter((item) =>
    `${item.name} ${item.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  const permissionNames = new Map(catalog.data?.groups.flatMap((group) =>
    group.permissions.map((permission) => [permission.code, permission.name] as const)) ?? []);

  async function revoke(token: ApiToken) {
    setPendingId(token.id);
    try {
      await api.revoke(token.id);
      toast.success(`已撤销“${token.name}”`);
      void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "api-tokens") });
    } catch (cause) { toast.error(cause); }
    finally { setPendingId(null); }
  }

  async function rotate(token: ApiToken) {
    setPendingId(token.id);
    try {
      const issued = await api.rotate(token.id);
      setRotatedToken({ name: issued.name, value: issued.token });
      void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "api-tokens") });
    } catch (cause) { toast.error(cause); }
    finally { setPendingId(null); }
  }

  async function deleteRevoked(token: ApiToken) {
    setPendingId(token.id);
    try {
      await api.deleteRevoked(token.id);
      toast.success(`已删除“${token.name}”`);
      void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "api-tokens") });
    } catch (cause) { toast.error(cause); }
    finally { setPendingId(null); }
  }

  async function copyRotatedToken() {
    if (!rotatedToken) return;
    try { await navigator.clipboard.writeText(rotatedToken.value); toast.success("Token 已复制"); }
    catch { toast.error(new Error("复制失败，请手动选中 Token 并复制")); }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">API Token 管理</h1><p className="mt-1 text-sm text-muted-foreground">查看和管理当前应用的 Token。</p></div>
      <Button asChild><Link to="new">创建 Token</Link></Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Input aria-label="搜索 Token" placeholder="搜索名称或 ID" className="w-full sm:w-72" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新列表</Button>
    </div>
    {list.isPending || catalog.isPending ? <Loading /> : list.isError || catalog.isError ? <><ErrorNotice error={list.error ?? catalog.error} /><Button variant="outline" onClick={() => { void list.refetch(); void catalog.refetch(); }}>重试</Button></> : <>
      <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>权限</TableHead><TableHead>状态</TableHead><TableHead>到期时间（上海）</TableHead><TableHead>创建信息（上海）</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
        {filtered.map((token) => <TableRow key={token.id}>
          <TableCell className="align-top"><div className="font-medium">{token.name}</div><div className="font-mono text-xs text-muted-foreground">{token.id}</div></TableCell>
          <TableCell className="align-top"><div className="flex flex-wrap gap-1">{token.permissions.map((permission) => <Badge key={permission} variant="secondary" title={permission}>{permissionNames.get(permission) ?? permission}</Badge>)}</div></TableCell>
          <TableCell className="align-top"><Badge variant="outline">{tokenStatus(token)}</Badge>{token.revokedAt && <div className="mt-1 text-xs text-muted-foreground">{formatTime(token.revokedAt)} 撤销</div>}</TableCell>
          <TableCell className="align-top">{token.expiresAt ? formatTime(token.expiresAt) : "永不过期"}</TableCell>
          <TableCell className="align-top"><div>{formatTime(token.createdAt)}</div><div className="text-xs text-muted-foreground">{token.createdBy ?? "未知创建者"}</div></TableCell>
          <TableCell className="align-top"><div className="flex gap-2">
            {!token.revokedAt && tokenStatus(token) === "有效" && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={pendingId !== null}>轮换</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>轮换“{token.name}”？</AlertDialogTitle><AlertDialogDescription>旧 Token 将立即失效。名称、权限和有效期保持不变；新 Token 明文只显示一次。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void rotate(token)}>确认轮换</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
            {!token.revokedAt && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="destructive" size="sm" disabled={pendingId !== null}>撤销</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>撤销“{token.name}”？</AlertDialogTitle><AlertDialogDescription>撤销后使用此 Token 的请求将立即失效，且无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void revoke(token)}>确认撤销</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
            {token.revokedAt && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="destructive" size="sm" disabled={pendingId !== null}>删除</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>永久删除“{token.name}”？</AlertDialogTitle><AlertDialogDescription>此 Token 已撤销。删除后，其元数据将从列表中移除，且无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteRevoked(token)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
          </div></TableCell>
        </TableRow>)}
        {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">{search ? "没有匹配的 Token" : "暂无 API Token"}</TableCell></TableRow>}
      </TableBody></Table></div>
      <p className="text-sm text-muted-foreground">显示 {filtered.length} 条，共 {list.data?.items.length ?? 0} 条</p>
    </>}
    <AlertDialog open={rotatedToken !== null} onOpenChange={(open) => { if (!open) setRotatedToken(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>保存新 Token</AlertDialogTitle><AlertDialogDescription>“{rotatedToken?.name}”已轮换，旧 Token 立即失效。新 Token 明文只显示这一次，关闭后无法再次查看。</AlertDialogDescription></AlertDialogHeader>
      <Input aria-label="轮换后的 Token 明文" readOnly value={rotatedToken?.value ?? ""} className="font-mono" onFocus={(event) => event.currentTarget.select()} />
      <AlertDialogFooter><Button type="button" variant="outline" onClick={() => void copyRotatedToken()}>复制 Token</Button><AlertDialogAction>我已保存</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
