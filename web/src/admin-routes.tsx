import { createBrowserRouter, createMemoryRouter, type RouteObject } from "react-router";
import { AppIndex, AppScope, NotFound, PlatformLayout } from "./AdminLayout";
import { ErrorNotice } from "./platform/feedback";

const adminRoutes: RouteObject[] = [{ path: "/admin", Component: PlatformLayout, errorElement: <ErrorNotice error={new Error("页面加载失败，请刷新后重试")} />, children: [
  { index: true, element: <div className="space-y-3 py-16"><h1 className="text-3xl font-semibold">应用管理</h1><p className="text-muted-foreground">从侧边栏选择一个应用，开始管理。</p></div> },
  { path: ":appId", Component: AppScope, children: [
    { index: true, Component: AppIndex },
    { path: "announcements", lazy: async () => ({ Component: (await import("./features/announcements/Announcements")).default }) },
    { path: "announcements/new", lazy: async () => ({ Component: (await import("./features/announcements/AnnouncementEditor")).default }) },
    { path: "announcements/:id", lazy: async () => ({ Component: (await import("./features/announcements/AnnouncementEditor")).default }) },
    { path: "whitelist", lazy: async () => ({ Component: (await import("./domains/buaa-classhopper/whitelist/WhitelistManagement")).default }) },
    { path: "reservations", lazy: async () => ({ Component: (await import("./domains/buaa-classhopper/reservations/Reservations")).default }) },
    { path: "api-tokens", lazy: async () => ({ Component: (await import("./features/api-tokens/ApiTokens")).default }) },
    { path: "api-tokens/new", lazy: async () => ({ Component: (await import("./features/api-tokens/CreateApiToken")).default }) },
    { path: "*", Component: NotFound },
  ] },
] }, { path: "*", Component: NotFound }];

export function createAdminRouter(initialEntries?: string[]) {
  return initialEntries ? createMemoryRouter(adminRoutes, { initialEntries }) : createBrowserRouter(adminRoutes);
}
