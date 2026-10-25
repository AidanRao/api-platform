import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../../http/errors";
import { parseInput as parse, jsonBody as body } from "../../http/validation";
import { errorResponse, methodNotAllowed, successResponse } from "../../http/response";
import { verifySsoRequest, type SsoVerifier } from "../../http/sso-auth";
import type { AppEnv } from "../../http/types";
import { createApiTokenRoutes } from "../../http/api-token";
import type { PermissionApp } from "../api-tokens/permissions";
import { VersionRepository } from "./repository";
import { createSegmentService } from "../segments/service";
import { segmentReferencesSchema } from "../segments/schema";
import { VersionService } from "./service";
import * as s from "./schema";

function routes() {
  const router = new Hono<AppEnv>();
  router.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
  router.use("*", bodyLimit({ maxSize: 320 * 1024, onError: () => errorResponse("请求体过大", 413) }));
  return router;
}
function service(c: Context<AppEnv>, appId: string, now: () => Date) {
  if (!c.env.API_PLATFORM_DB || !c.env.API_PLATFORM_KV) throw new ApiError("平台存储尚未配置", 503);
  return new VersionService(new VersionRepository(c.env.API_PLATFORM_DB, appId), createSegmentService(c.env.API_PLATFORM_DB, c.env.API_PLATFORM_KV, now), now);
}
function audit(c: Context<AppEnv>, appId: string, action: string) {
  const token = c.get("apiTokenIdentity");
  const actor = token ? { actorTokenId: token.tokenId } : { actorSubject: c.get("accessIdentity").subject };
  console.log(JSON.stringify({ message: "versions changed", appId, action, ...actor }));
}
export function createApiTokenVersionRoutes(appId: PermissionApp, now: () => Date) {
  const router = routes(), tokenRoutes = createApiTokenRoutes(appId);
  tokenRoutes.post("/", "versions:create", async (c) => {
    const input = parse(s.createTokenVersionSchema, await body(c));
    const value = await service(c, appId, now).create({ ...input, releaseType: "gray" });
    audit(c, appId, "create"); return successResponse("版本已创建", value, 201);
  });
  router.route("/", tokenRoutes.routes);
  router.all("/", () => methodNotAllowed("POST"));
  return router;
}
export function createPublicVersionRoutes(appId: string, now: () => Date, verify: SsoVerifier = verifySsoRequest) {
  const router = routes();
  router.get("/latest", async (c) => {
    if (Object.keys(c.req.query()).length) throw new ApiError("版本查询不接受请求参数", 400);
    const identity = c.req.raw.headers.has("Authorization") ? await verify(c.req.raw, c.env.SSO_ISSUER, appId) : undefined;
    return successResponse("获取成功", await service(c, appId, now).resolve(identity?.userId));
  });
  router.all("/latest", () => methodNotAllowed("GET"));
  return router;
}
export function createAdminVersionRoutes(appId: string, now: () => Date) {
  const router = routes();
  router.get("/", async (c) => successResponse("获取成功", await service(c, appId, now).repo.list(parse(s.pageQuerySchema, c.req.query()))));
  router.post("/", async (c) => {
    const value = await service(c, appId, now).create(parse(s.createVersionSchema, await body(c)));
    audit(c, appId, "create"); return successResponse("版本已创建", value, 201);
  });
  router.get("/latest", async (c) => successResponse("获取成功", await service(c, appId, now).settings()));
  router.put("/latest", async (c) => {
    const input = parse(s.latestInputSchema, await body(c));
    const value = await service(c, appId, now).setLatest(input.version, input.revision);
    audit(c, appId, "latest"); return successResponse("最新版本已更新", value);
  });
  router.all("/latest", () => methodNotAllowed("GET, PUT"));
  router.put("/:version/segments", async (c) => {
    const input = parse(segmentReferencesSchema, await body(c));
    const value = await service(c, appId, now).setSegments(parse(s.versionNumberSchema, c.req.param("version")), input.revision, input.segmentIds);
    audit(c, appId, "segments"); return successResponse("灰度人群已保存", value);
  });
  router.all("/:version/segments", () => methodNotAllowed("PUT"));
  router.get("/:version", async (c) => successResponse("获取成功", await service(c, appId, now).require(parse(s.versionNumberSchema, c.req.param("version")))));
  router.patch("/:version", async (c) => {
    const value = await service(c, appId, now).update(parse(s.versionNumberSchema, c.req.param("version")), parse(s.patchVersionSchema, await body(c)));
    audit(c, appId, "update"); return successResponse("版本已保存", value);
  });
  router.delete("/:version", async (c) => {
    await service(c, appId, now).delete(parse(s.versionNumberSchema, c.req.param("version")), parse(s.revisionSchema, await body(c)).revision);
    audit(c, appId, "delete"); return successResponse("版本已删除", null);
  });
  router.all("/", () => methodNotAllowed("GET, POST"));
  router.all("/:version", () => methodNotAllowed("GET, PATCH, DELETE"));
  return router;
}
