import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { createAdminRouter } from "./admin-routes";
import { createQueryClient } from "./platform/query";

const queryClient = createQueryClient();
let browserRouter: ReturnType<typeof createAdminRouter> | undefined;

export function App() {
  browserRouter ??= createAdminRouter();
  return <QueryClientProvider client={queryClient}><RouterProvider router={browserRouter} /></QueryClientProvider>;
}
