import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { AppDefinition } from "../../../src/apps/schema";
import { appLandingPath, sectionsForApp } from "./sections";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type PageTitle = { pathname: string; title: string } | null;
const HeaderContext = createContext<{
  pageTitle: PageTitle;
  setPageTitle: Dispatch<SetStateAction<PageTitle>>;
} | null>(null);

export function AdminHeaderProvider({ children }: { children: ReactNode }) {
  const [pageTitle, setPageTitle] = useState<PageTitle>(null);
  const value = useMemo(() => ({ pageTitle, setPageTitle }), [pageTitle]);
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function useAdminPageTitle(title: string) {
  const context = useContext(HeaderContext);
  if (!context) throw new Error("AdminHeaderProvider is required");
  const { setPageTitle } = context;
  const { pathname } = useLocation();
  useEffect(() => {
    setPageTitle({ pathname, title });
    return () => setPageTitle(null);
  }, [pathname, title, setPageTitle]);
}

const platformSections = [
  { id: "segments", label: "人群管理" },
  { id: "ads/campaigns", label: "广告活动" },
  { id: "ads/creatives", label: "共享素材" },
];
const editorTitles: Record<string, { create: string; edit: string }> = {
  segments: { create: "新建人群", edit: "编辑人群" },
  "ads/campaigns": { create: "新建活动", edit: "编辑活动" },
  "ads/creatives": { create: "新建素材", edit: "编辑素材" },
  "ads/slots": { create: "新建广告位", edit: "编辑广告位" },
  "ads/placements": { create: "新建投放", edit: "编辑投放" },
  announcements: { create: "新增草稿", edit: "编辑公告" },
  versions: { create: "新建版本", edit: "编辑版本" },
  "api-tokens": { create: "创建 Token", edit: "编辑 Token" },
};

export function AdminHeader({ app, platformScope }: { app?: AppDefinition; platformScope: "ads" | "segments" | null }) {
  const { pathname } = useLocation();
  const context = useContext(HeaderContext);
  const base = app ? `/admin/${encodeURIComponent(app.id)}` : "/admin";
  const sections = app ? sectionsForApp(app) : platformScope ? platformSections : [];
  const section = sections.find(({ id }) => pathname === `${base}/${id}` || pathname.startsWith(`${base}/${id}/`));
  const listPath = section ? `${base}/${section.id}` : null;
  const leaf = listPath ? pathname.slice(listPath.length).replace(/^\//, "") : "";
  const editor = section && leaf && !leaf.includes("/") ? editorTitles[section.id] : undefined;
  const title = editor
    ? context?.pageTitle?.pathname === pathname ? context.pageTitle.title : leaf === "new" ? editor.create : editor.edit
    : section?.label;
  const crumbs: { label: string; to?: string }[] = [
    { label: platformScope === "ads" ? "平台广告" : platformScope === "segments" ? "平台管理" : "应用管理", to: "/admin/" },
    ...(app ? [{ label: app.name, to: appLandingPath(app) }] : []),
    ...(section ? [{ label: section.label, ...(editor ? { to: listPath! } : {}) }] : []),
    ...(editor && title ? [{ label: title }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 flex min-h-16 shrink-0 items-center gap-3 border-b bg-background px-4 py-3 md:px-8">
      <SidebarTrigger aria-label="切换侧边栏" />
      <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <nav aria-label="当前位置" className="min-w-0 flex-1">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:text-sm">
          {crumbs.map((crumb, index) => {
            const current = index === crumbs.length - 1;
            return (
              <li key={`${index}/${crumb.label}`} className={cn("flex min-w-0 items-center gap-2", index === 0 && crumbs.length > 1 && "hidden sm:flex")}>
                {index > 0 && <span aria-hidden="true" className={index === 1 ? "hidden sm:inline" : undefined}>/</span>}
                {!current && crumb.to ? (
                  <Link to={crumb.to} aria-label={`返回${crumb.label}${crumb.to === listPath ? "列表" : ""}`} className="max-w-36 truncate hover:text-foreground hover:underline">{crumb.label}</Link>
                ) : (
                  <span aria-current="page" className="font-medium text-foreground">{crumb.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {editor && listPath && (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={listPath} aria-label="返回列表" title="返回列表">
            <ArrowLeft aria-hidden="true" />
            <span className="hidden sm:inline">返回列表</span>
          </Link>
        </Button>
      )}
    </header>
  );
}
