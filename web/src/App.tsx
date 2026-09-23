import { useEffect } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createBrowserRouter, createMemoryRouter, RouterProvider, Outlet, Navigate, NavLink, useMatch, useLocation, useNavigate, useParams, type RouteObject } from "react-router";
import { AppProvider } from "./platform/AppContext";
import { appsQuery, createQueryClient } from "./platform/query";
import { appLandingPath, sectionsForApp } from "./platform/sections";
import { DraftProvider, DraftNavigationGuard } from "./platform/drafts";
import { ErrorNotice, Loading } from "./platform/feedback";
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

function PlatformLayout() {
  const apps = useQuery(appsQuery);
  const match = useMatch("/admin/:appId/*");
  const app = apps.data?.items.find((item) => item.id === match?.params.appId);
  useEffect(() => { document.title = app ? `${app.name} · 应用管理` : "API Platform · 应用管理"; }, [app]);
  return <DraftProvider><TooltipProvider><SidebarProvider>
    <Navigation /><SidebarInset><header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-8">
      <SidebarTrigger aria-label="切换侧边栏" /><span className="text-sm text-muted-foreground">应用管理</span><span className="text-sm font-medium">{app?.name}</span>
    </header><main className="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 md:p-8">
      {apps.isPending ? <Loading /> : apps.isError ? <><ErrorNotice error={apps.error} /><Button onClick={() => void apps.refetch()}>重新加载应用列表</Button></> : <Outlet />}
    </main></SidebarInset><DraftNavigationGuard />
  </SidebarProvider></TooltipProvider></DraftProvider>;
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
      if (next) { navigate(appLandingPath(next, location.pathname.split("/")[3])); setOpenMobile(false); }
    }}><SelectTrigger className="w-full" aria-label="选择应用"><SelectValue placeholder="选择应用" /></SelectTrigger>
      <SelectContent>{data?.items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
    </Select>
  </SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>管理功能</SidebarGroupLabel><SidebarMenu>
    {app && sectionsForApp(app).map((section) => <SidebarMenuItem key={section.id}>
      <SidebarMenuButton asChild isActive={location.pathname.startsWith(`/admin/${app.id}/${section.id}`)}><NavLink to={`/admin/${app.id}/${section.id}`} onClick={() => setOpenMobile(false)}>{section.label}</NavLink></SidebarMenuButton>
    </SidebarMenuItem>)}
  </SidebarMenu></SidebarGroup></SidebarContent></Sidebar>;
}
function AppScope() {
  const { appId } = useParams();
  const { data } = useQuery(appsQuery);
  const app = data?.items.find((item) => item.id === appId);
  return app ? <AppProvider key={app.id} app={app}><Outlet /></AppProvider> : <NotFound />;
}
function AppIndex() {
  const { appId } = useParams();
  const { data } = useQuery(appsQuery);
  const app = data?.items.find((item) => item.id === appId);
  return app ? <Navigate to={appLandingPath(app)} replace /> : <NotFound />;
}
function NotFound() { return <h1 className="text-2xl font-semibold">页面或应用不存在</h1>; }
export const adminRoutes: RouteObject[] = [{ path: "/admin", Component: PlatformLayout, errorElement: <ErrorNotice error={new Error("页面加载失败，请刷新后重试")} />, children: [
  { index: true, element: <div className="space-y-3 py-16"><h1 className="text-3xl font-semibold">应用管理</h1><p className="text-muted-foreground">从侧边栏选择一个应用，开始管理。</p></div> },
  { path: ":appId", Component: AppScope, children: [
    { index: true, Component: AppIndex },
    { path: "announcements", lazy: async () => ({ Component: (await import("./features/announcements/Announcements")).default }) },
    { path: "announcements/new", lazy: async () => ({ Component: (await import("./features/announcements/AnnouncementEditor")).default }) },
    { path: "announcements/:id", lazy: async () => ({ Component: (await import("./features/announcements/AnnouncementEditor")).default }) },
    { path: "whitelist", lazy: async () => ({ Component: (await import("./domains/buaa-classhopper/WhitelistManagement")).default }) },
    { path: "*", Component: NotFound },
  ] },
] }, { path: "*", Component: NotFound }];
export function createAdminRouter(initialEntries?: string[]) { return initialEntries ? createMemoryRouter(adminRoutes, { initialEntries }) : createBrowserRouter(adminRoutes); }
const queryClient = createQueryClient();
let browserRouter: ReturnType<typeof createAdminRouter> | undefined;
export function App() { browserRouter ??= createAdminRouter(); return <QueryClientProvider client={queryClient}><RouterProvider router={browserRouter} /></QueryClientProvider>; }
