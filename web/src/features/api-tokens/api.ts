import { z } from "zod";

import { createAdminClient, jsonRequest } from "../../platform/api";

const tokenSchema = z.object({
  id: z.string(), appId: z.string(), name: z.string(), permissions: z.array(z.string()),
  expiresAt: z.string().nullable(), revokedAt: z.string().nullable(),
  createdBy: z.string().nullable(), createdAt: z.string(),
});
const issuedTokenSchema = tokenSchema.extend({ token: z.string() });
const tokenListSchema = z.object({ items: z.array(tokenSchema) });
const deletedTokenSchema = z.object({ id: z.string() });
const permissionCatalogSchema = z.object({
  groups: z.array(z.object({
    code: z.string(), name: z.string(),
    permissions: z.array(z.object({ code: z.string(), name: z.string() })),
  })),
});

export type ApiToken = z.infer<typeof tokenSchema>;
export type PermissionCatalog = z.infer<typeof permissionCatalogSchema>;
export function createApiTokenClient(appId: string) {
  const request = createAdminClient(appId);
  return {
    list: (signal?: AbortSignal) => request("/api-tokens", tokenListSchema, { signal }),
    permissions: (signal?: AbortSignal) => request("/api-tokens/permissions", permissionCatalogSchema, { signal }),
    create: (input: { name: string; permissions: string[]; expiresAt?: string }) =>
      request("/api-tokens", issuedTokenSchema, jsonRequest("POST", input)),
    revoke: (id: string) => request(`/api-tokens/${encodeURIComponent(id)}`, tokenSchema, { method: "DELETE" }),
    rotate: (id: string) => request(`/api-tokens/${encodeURIComponent(id)}/rotate`, issuedTokenSchema, { method: "POST" }),
    deleteRevoked: (id: string) => request(`/api-tokens/${encodeURIComponent(id)}/permanent`, deletedTokenSchema, { method: "DELETE" }),
  };
}
