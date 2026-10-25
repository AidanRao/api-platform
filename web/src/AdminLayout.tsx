import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, Navigate, NavLink, useMatch, useLocation, useNavigate, useParams } from "react-router";
import { AppProvider } from "./platform/AppContext";
import { appsQuery } from "./platform/query";
import { appLandingPath, sectionsForApp } from "./platform/sections";
import { DraftProvider, DraftNavigationGuard } from "./platform/drafts";
import { ErrorNotice, Loading, ToastProvider } from "./platform/feedback";
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminHeader, AdminHeaderProvider } from "./platform/AdminHeader";

export function PlatformLayout() {
  const apps = useQuery(appsQuery);
  const platformAds = useMatch("/admin/ads/*");
  const platformSegments = useMatch("/admin/segments/*");
  const match = useMatch("/admin/:appId/*");
  const app = apps.data?.items.find((item) => item.id === match?.params.appId);
  useEffect(() => { document.title = app ? `${app.name} / 应用管理` : platformAds ? "API Platform / 平台广告" : platformSegments ? "API Platform / 人群管理" : "API Platform / 应用管理"; }, [app, platformAds, platformSegments]);
  return <ToastProvider><DraftProvider><TooltipProvider><SidebarProvider><AdminHeaderProvider>
    <Navigation /><SidebarInset><AdminHeader app={app} platformScope={platformAds ? "ads" : platformSegments ? "segments" : null} />
    <main data-page-content className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 pb-[calc(1rem+var(--editor-actions-height,0px))] md:p-8 md:pb-[calc(2rem+var(--editor-actions-height,0px))]">
      {apps.isPending ? <Loading /> : apps.isError ? <><ErrorNotice error={apps.error} /><Button onClick={() => void apps.refetch()}>重新加载应用列表</Button></> : <Outlet />}
    </main></SidebarInset><DraftNavigationGuard />
  </AdminHeaderProvider></SidebarProvider></TooltipProvider></DraftProvider></ToastProvider>;
}
function Navigation() {
  const { data } = useQuery(appsQuery);
  const match = useMatch("/admin/:appId/*");
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const app = data?.items.find((item) => item.id === match?.params.appId);
  return <Sidebar><SidebarHeader className="gap-5 p-4">
    <NavLink to="/admin/" className="text-lg font-semibold tracking-tight">API Platform</NavLink>
    <Select value={app?.id ?? ""} onValueChange={(id) => {
      const next = data?.items.find((item) => item.id === id);
      if (next) { navigate(appLandingPath(next, location.pathname.split("/").slice(3, location.pathname.split("/")[3] === "ads" ? 5 : 4).join("/"))); setOpenMobile(false); }
    }}><SelectTrigger className="w-full" aria-label="选择应用"><SelectValue placeholder="选择应用" /></SelectTrigger>
      <SelectContent>{data?.items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
    </Select>
  </SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>平台管理</SidebarGroupLabel><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild isActive={location.pathname.startsWith("/admin/segments")}><NavLink to="/admin/segments" onClick={() => setOpenMobile(false)}>人群管理</NavLink></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup><SidebarGroup><SidebarGroupLabel>平台广告</SidebarGroupLabel><SidebarMenu>{[{ path: "campaigns", label: "广告活动" }, { path: "creatives", label: "共享素材" }].map((item) => <SidebarMenuItem key={item.path}><SidebarMenuButton asChild isActive={location.pathname.startsWith(`/admin/ads/${item.path}`)}><NavLink to={`/admin/ads/${item.path}`} onClick={() => setOpenMobile(false)}>{item.label}</NavLink></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup><SidebarGroup><SidebarGroupLabel>管理功能</SidebarGroupLabel><SidebarMenu>
    {app && sectionsForApp(app).map((section) => <SidebarMenuItem key={section.id}>
      <SidebarMenuButton asChild isActive={location.pathname.startsWith(`/admin/${app.id}/${section.id}`)}><NavLink to={`/admin/${app.id}/${section.id}`} onClick={() => setOpenMobile(false)}>{section.label}</NavLink></SidebarMenuButton>
    </SidebarMenuItem>)}
  </SidebarMenu></SidebarGroup></SidebarContent></Sidebar>;
}
export function AppScope() {
  const { appId } = useParams();
  const { data } = useQuery(appsQuery);
  const app = data?.items.find((item) => item.id === appId);
  return app ? <AppProvider key={app.id} app={app}><Outlet /></AppProvider> : <NotFound />;
}
export function AppIndex() {
  const { appId } = useParams();
  const { data } = useQuery(appsQuery);
  const app = data?.items.find((item) => item.id === appId);
  return app ? <Navigate to={appLandingPath(app)} replace /> : <NotFound />;
}
export function NotFound() { return <h1 className="text-2xl font-semibold">页面或应用不存在</h1>; }
