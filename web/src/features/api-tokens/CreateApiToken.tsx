import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import { useApplication } from "../../platform/AppContext";
import { ErrorNotice, Loading, useToast } from "../../platform/feedback";
import { resourceKey } from "../../platform/query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiTokenClient } from "./api";
import { formatTime } from "./presentation";

type Expiration = "never" | "7d" | "30d" | "90d" | "1y" | "custom";
type TokenDraft = { name: string; permissions: string[]; expiresAt?: string };

const expirationOptions: readonly { value: Expiration; label: string }[] = [
  { value: "never", label: "永不过期" }, { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" }, { value: "90d", label: "90 天" },
  { value: "1y", label: "1 年" }, { value: "custom", label: "自定义" },
];

function expirationAt(choice: Expiration, custom: string): string | undefined {
  if (choice === "never") return undefined;
  if (choice === "custom") {
    const date = new Date(custom);
    if (!custom || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new Error("请选择晚于当前时间的到期时间");
    }
    return date.toISOString();
  }
  const date = new Date();
  if (choice === "1y") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setTime(date.getTime() + Number.parseInt(choice, 10) * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function TokenSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-lg border">
    <h2 className="border-b bg-muted/40 px-5 py-3 text-sm font-medium text-muted-foreground">{title}</h2>
    <div className="p-5">{children}</div>
  </section>;
}

export default function CreateApiToken() {
  const app = useApplication();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useMemo(() => createApiTokenClient(app.id), [app.id]);
  const catalog = useQuery({
    queryKey: [...resourceKey(app.id, "api-tokens"), "permissions"],
    queryFn: ({ signal }) => api.permissions(signal),
  });
  const path = `/admin/${app.id}/api-tokens`;
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expiration, setExpiration] = useState<Expiration>("never");
  const [customExpiration, setCustomExpiration] = useState("");
  const [preview, setPreview] = useState<TokenDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const permissionCount = catalog.data?.groups.reduce((count, group) => count + group.permissions.length, 0) ?? 0;

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog.data || !name.trim() || selected.length === 0) {
      toast.error(new Error("请填写名称并选择至少一项权限"));
      return;
    }
    const allowed = new Set(catalog.data.groups.flatMap((group) => group.permissions.map((permission) => permission.code)));
    if (!selected.every((code) => allowed.has(code))) {
      toast.error(new Error("所选权限已变更，请重新选择"));
      return;
    }
    try {
      const expiresAt = expirationAt(expiration, customExpiration);
      setPreview({ name: name.trim(), permissions: [...selected], ...(expiresAt ? { expiresAt } : {}) });
    } catch (cause) { toast.error(cause); }
  }

  async function create() {
    if (!preview) return;
    if (preview.expiresAt && Date.parse(preview.expiresAt) <= Date.now()) {
      toast.error(new Error("预览的到期时间已过，请返回修改"));
      return;
    }
    setCreating(true);
    try {
      const created = await api.create(preview);
      setIssuedToken(created.token);
      toast.success("Token 已创建，请立即复制并保存");
      void queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "api-tokens") });
    } catch (cause) { toast.error(cause); }
    finally { setCreating(false); }
  }

  async function copyToken() {
    if (!issuedToken) return;
    try { await navigator.clipboard.writeText(issuedToken); toast.success("Token 已复制"); }
    catch { toast.error(new Error("复制失败，请手动选中 Token 并复制")); }
  }

  return <div className="mx-auto max-w-3xl space-y-6">
    <nav aria-label="面包屑" className="text-sm text-muted-foreground"><Link className="hover:underline" to={path}>API Token 管理</Link><span className="mx-2">/</span>{issuedToken ? "保存 Token" : preview ? "预览 Token" : "创建 Token"}</nav>
    <h1 className="text-2xl font-semibold">{issuedToken ? "保存新 Token" : preview ? "预览 API Token" : "创建 API Token"}</h1>
    {issuedToken ? <div className="space-y-4 rounded-lg border p-5" role="region" aria-label="新建 API Token">
      <p className="font-medium">Token 已创建，请立即复制并保存。</p><p className="text-sm text-muted-foreground">明文只显示这一次，离开后无法再次查看。</p>
      <Input aria-label="Token 明文" readOnly value={issuedToken} className="font-mono" onFocus={(event) => event.currentTarget.select()} />
      <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void copyToken()}>复制 Token</Button><Button asChild variant="outline"><Link to={path}>返回列表</Link></Button></div>
    </div> : catalog.isPending ? <Loading /> : catalog.isError ? <div className="space-y-3"><ErrorNotice error={catalog.error} /><Button type="button" variant="outline" onClick={() => void catalog.refetch()}>重试加载权限</Button></div>
      : preview ? <div className="space-y-6" role="region" aria-label="Token 创建预览">
        <p className="text-sm text-muted-foreground">确认以下信息后再创建 Token。</p>
        <TokenSection title="Token 名称"><p className="font-medium">{preview.name}</p></TokenSection>
        <TokenSection title="权限">
          <div className="space-y-4">{catalog.data.groups.map((group) => {
            const chosen = group.permissions.filter((permission) => preview.permissions.includes(permission.code));
            return chosen.length > 0 && <div key={group.code}>
              <h3 className="text-sm font-medium">{group.name}</h3>
              <ul className="mt-2 space-y-2">{chosen.map((permission) => <li key={permission.code} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span>{permission.name}</span><span className="font-mono text-xs text-muted-foreground">{permission.code}</span>
              </li>)}</ul>
            </div>;
          })}</div>
        </TokenSection>
        <TokenSection title="Token 有效期"><p>{preview.expiresAt ? `${formatTime(preview.expiresAt)}（上海）` : "永不过期"}</p></TokenSection>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-5"><Button type="button" variant="outline" disabled={creating} onClick={() => setPreview(null)}>返回修改</Button><Button type="button" disabled={creating} onClick={() => void create()}>{creating ? "创建中…" : "确认创建 Token"}</Button></div>
      </div> : <form className="space-y-6" onSubmit={review}>
        <TokenSection title="Token 名称"><div className="max-w-lg space-y-2"><Label htmlFor="api-token-name">名称</Label><Input id="api-token-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="例如：签到服务" required /></div></TokenSection>
        <TokenSection title="权限">
          {permissionCount === 0 ? <p className="text-sm text-muted-foreground">当前应用尚未配置 API Token 权限。</p> : <div className="space-y-4">{catalog.data.groups.map((group) => <fieldset key={group.code} className="overflow-hidden rounded-md border">
            <legend className="sr-only">{group.name}</legend>
            <div aria-hidden="true" className="border-b bg-muted/30 px-4 py-2 text-sm font-medium">{group.name}</div>
            <div className="divide-y">{group.permissions.map((permission) => <div key={permission.code} className="flex items-start gap-3 px-4 py-3">
              <Checkbox id={`permission-${permission.code}`} checked={selected.includes(permission.code)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, permission.code] : current.filter((value) => value !== permission.code))} />
              <Label htmlFor={`permission-${permission.code}`} className="min-w-0 flex-1 flex-col items-start gap-0 cursor-pointer leading-5"><span>{permission.name}</span><span className="break-all font-mono text-xs font-normal text-muted-foreground">{permission.code}</span></Label>
            </div>)}</div>
          </fieldset>)}</div>}
        </TokenSection>
        <TokenSection title="Token 有效期">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Token 有效期">
            {expirationOptions.map((option) => <Button key={option.value} type="button" variant={expiration === option.value ? "secondary" : "outline"} aria-pressed={expiration === option.value} onClick={() => setExpiration(option.value)}>{option.label}</Button>)}
          </div>
          {expiration === "custom" && <div className="mt-4 max-w-xs space-y-2"><Label htmlFor="api-token-expiry">自定义到期时间</Label><Input id="api-token-expiry" type="datetime-local" value={customExpiration} onChange={(event) => setCustomExpiration(event.target.value)} required /><p className="text-xs text-muted-foreground">按浏览器本地时间填写。</p></div>}
        </TokenSection>
        <div className="flex flex-wrap justify-between gap-2 border-t pt-5"><Button asChild variant="outline"><Link to={path}>取消</Link></Button><Button type="submit" disabled={permissionCount === 0}>预览 Token</Button></div>
      </form>}
  </div>;
}
