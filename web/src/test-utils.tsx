import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { createAdminRouter } from "./App";
import { createQueryClient } from "./platform/query";
export const apps = [{ id: "buaa-classhopper", name: "BUAA ClassHopper" }, { id: "second-app", name: "Second App" }];
export const ok = (data: unknown) => Response.json({ code: 1, msg: "获取成功", data });
export const fail = (status: number, msg: string) => Response.json({ code: 0, msg, data: null }, { status });
export function renderAdmin(path = "/admin/buaa-classhopper/", preloadApps = true) {
  const client = createQueryClient();
  if (preloadApps) client.setQueryData(["platform", "apps"], { items: apps });
  const router = createAdminRouter([path]);
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { ...view, router, client };
}
