import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import { generateApiToken, hashApiToken } from "../../http/api-token";
import { appPermissionGroups, appPermissions } from "./permissions";
import { ApiError } from "../../http/errors";
import { errorResponse, methodNotAllowed, successResponse } from "../../http/response";
import type { AppEnv } from "../../http/types";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(z.string()).min(1).max(32),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

type TokenRow = {
  id: string; appId: string; name: string; permissionsJson: string;
  expiresAt: string | null; revokedAt: string | null; createdBy: string | null; createdAt: string;
};
const columns = "id, app_id AS appId, name, permissions_json AS permissionsJson, expires_at AS expiresAt, revoked_at AS revokedAt, created_by AS createdBy, created_at AS createdAt";
const view = (row: TokenRow) => ({
  id: row.id, appId: row.appId, name: row.name,
  permissions: JSON.parse(row.permissionsJson) as string[],
  expiresAt: row.expiresAt, revokedAt: row.revokedAt,
  createdBy: row.createdBy, createdAt: row.createdAt,
});

export function createAdminApiTokenRoutes(appId: string, now: () => Date) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (context, next) => { await next(); context.header("Cache-Control", "no-store"); });
  routes.get("/permissions", () => successResponse("获取成功", { groups: appPermissionGroups(appId) }));
  routes.get("/", async (context) => {
    const result = await context.env.API_PLATFORM_DB.prepare(
      `SELECT ${columns} FROM api_tokens WHERE app_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(appId).all<TokenRow>();
    return successResponse("获取成功", { items: result.results.map(view) });
  });
  routes.post("/", bodyLimit({ maxSize: 16 * 1024, onError: () => errorResponse("请求体不能超过 16 KiB", 413) }),
    zValidator("json", createSchema, (result) => {
    if (!result.success) return errorResponse("请求数据格式错误", 400);
  }), async (context) => {
    const input = context.req.valid("json");
    const allowed = appPermissions(appId);
    if (new Set(input.permissions).size !== input.permissions.length ||
        !input.permissions.every((permission) => allowed.includes(permission))) {
      throw new ApiError("API Token 权限无效", 400);
    }
    const issuedAt = now().toISOString();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
    if (expiresAt && expiresAt <= issuedAt) throw new ApiError("过期时间必须晚于当前时间", 400);
    const token = generateApiToken();
    const row = await context.env.API_PLATFORM_DB.prepare(
      `INSERT INTO api_tokens (id, app_id, name, token_hash, permissions_json, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`,
    ).bind(crypto.randomUUID(), appId, input.name, await hashApiToken(token),
      JSON.stringify(input.permissions), expiresAt, context.get("accessIdentity").subject, issuedAt).first<TokenRow>();
    if (!row) throw new Error("API Token insert returned no row");
    return successResponse("创建成功", { ...view(row), token }, 201);
  });
  routes.delete("/:id", async (context) => {
    const row = await context.env.API_PLATFORM_DB.prepare(
      `UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE app_id = ? AND id = ? RETURNING ${columns}`,
    ).bind(now().toISOString(), appId, context.req.param("id")).first<TokenRow>();
    if (!row) throw new ApiError("API Token 不存在", 404);
    return successResponse("已撤销", view(row));
  });
  routes.post("/:id/rotate", async (context) => {
    const id = context.req.param("id");
    const current = await context.env.API_PLATFORM_DB.prepare(
      "SELECT token_hash AS tokenHash, expires_at AS expiresAt, revoked_at AS revokedAt FROM api_tokens WHERE app_id = ? AND id = ?",
    ).bind(appId, id).first<{ tokenHash: string; expiresAt: string | null; revokedAt: string | null }>();
    if (!current) throw new ApiError("API Token 不存在", 404);
    const rotatedAt = now().toISOString();
    if (current.revokedAt || (current.expiresAt && current.expiresAt <= rotatedAt)) {
      throw new ApiError("已撤销或已过期的 API Token 不能轮换", 409);
    }
    const token = generateApiToken();
    const row = await context.env.API_PLATFORM_DB.prepare(
      `UPDATE api_tokens SET token_hash = ?
       WHERE app_id = ? AND id = ? AND token_hash = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       RETURNING ${columns}`,
    ).bind(await hashApiToken(token), appId, id, current.tokenHash, rotatedAt).first<TokenRow>();
    if (!row) throw new ApiError("API Token 已变更，请刷新后重试", 409);
    return successResponse("轮换成功", { ...view(row), token });
  });
  routes.delete("/:id/permanent", async (context) => {
    const id = context.req.param("id");
    const deleted = await context.env.API_PLATFORM_DB.prepare(
      "DELETE FROM api_tokens WHERE app_id = ? AND id = ? AND revoked_at IS NOT NULL RETURNING id",
    ).bind(appId, id).first<{ id: string }>();
    if (deleted) return successResponse("已删除", deleted);
    const exists = await context.env.API_PLATFORM_DB.prepare(
      "SELECT id FROM api_tokens WHERE app_id = ? AND id = ?",
    ).bind(appId, id).first<{ id: string }>();
    if (!exists) throw new ApiError("API Token 不存在", 404);
    throw new ApiError("请先撤销 API Token，再永久删除", 409);
  });
  routes.all("/", () => methodNotAllowed("GET, POST"));
  routes.all("/permissions", () => methodNotAllowed("GET"));
  routes.all("/:id", () => methodNotAllowed("DELETE"));
  routes.all("/:id/rotate", () => methodNotAllowed("POST"));
  routes.all("/:id/permanent", () => methodNotAllowed("DELETE"));
  return routes;
}
