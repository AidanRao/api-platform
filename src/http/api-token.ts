import { createMiddleware } from "hono/factory";
import { Hono, type Handler } from "hono";

import { ApiError } from "./errors";
import { bearerToken } from "./sso-auth";
import type { AppEnv } from "./types";
import { appPermissions, type PermissionApp, type PermissionFor } from "../features/api-tokens/permissions";

const encoder = new TextEncoder();
const tokenPattern = /^apt_[A-Za-z0-9_-]{43}$/;
export async function hashApiToken(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `apt_${base64}`;
}

export function apiTokenAuth(appId: string, permission: string) {
  if (!appPermissions(appId).includes(permission)) throw new Error(`Unknown permission: ${appId}/${permission}`);
  return createMiddleware<AppEnv>(async (context, next) => {
    const token = bearerToken(context.req.raw);
    if (!tokenPattern.test(token)) throw new ApiError("API Token 无效", 401);
    const hash = await hashApiToken(token);
    const row = await context.env.API_PLATFORM_DB.prepare(
      "SELECT id, permissions_json AS permissionsJson, expires_at AS expiresAt, revoked_at AS revokedAt FROM api_tokens WHERE app_id = ? AND token_hash = ?",
    ).bind(appId, hash).first<{ id: string; permissionsJson: string; expiresAt: string | null; revokedAt: string | null }>();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date().toISOString())) {
      throw new ApiError("API Token 无效", 401);
    }
    const permissions: unknown = JSON.parse(row.permissionsJson);
    if (!Array.isArray(permissions) || !permissions.every((item) => typeof item === "string")) {
      throw new Error("Stored API Token permissions are invalid");
    }
    if (!permissions.includes(permission)) throw new ApiError("API Token 权限不足", 403);
    context.set("apiTokenIdentity", { tokenId: row.id, appId });
    await next();
  });
}

/** A token route cannot be registered without a permission. */
export function createApiTokenRoutes<const A extends PermissionApp>(appId: A) {
  const routes = new Hono<AppEnv>();
  return {
    get(path: string, permission: PermissionFor<A>, handler: Handler<AppEnv>) {
      routes.get(path, apiTokenAuth(appId, permission), handler);
      return this;
    },
    routes,
  };
}
