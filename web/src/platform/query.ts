import { QueryClient, queryOptions } from "@tanstack/react-query";
import { appListSchema } from "../../../src/apps/schema";
import { platformClient } from "./api";

export const createQueryClient = () => new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, retry: false },
  mutations: { retry: false },
} });
export const appsQuery = queryOptions({
  queryKey: ["platform", "apps"],
  queryFn: ({ signal }) => platformClient("/apps", appListSchema, { signal }),
});
export const resourceKey = (appId: string, resource: string) => ["apps", appId, resource] as const;
