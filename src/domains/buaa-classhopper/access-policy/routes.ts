import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { errorResponse, methodNotAllowed, successResponse } from "../../../http/response";
import { jsonBody, parseInput } from "../../../http/validation";
import type { AppEnv } from "../../../http/types";
import { createSegmentService } from "../../../features/segments/service";
import { HEADER_APP_VERSION, MIN_ACCESS_POLICY_APP_VERSION, isSupportedAppVersion, parseAppVersion } from "./app-version";
import { policyUpdateSchema } from "./schema";
import { AccessPolicyRepository } from "./repository";
import { AccessPolicyService } from "./service";

export const PUBLIC_BUAA_CLASSHOPPER_BASE_PATH = "/api/buaa-classhopper";
export const ADMIN_BUAA_CLASSHOPPER_BASE_PATH = "/api/admin/buaa-classhopper";
export const ACCESS_POLICY_ROUTE_PATH = "/v1/iclass/access-policy";
export const PUBLIC_ACCESS_POLICY_PATH = `${PUBLIC_BUAA_CLASSHOPPER_BASE_PATH}${ACCESS_POLICY_ROUTE_PATH}`;
export const ADMIN_ACCESS_POLICY_PATH = `${ADMIN_BUAA_CLASSHOPPER_BASE_PATH}${ACCESS_POLICY_ROUTE_PATH}`;
function service(c: Context<AppEnv>, now: () => Date) {
  return new AccessPolicyService(new AccessPolicyRepository(c.env.API_PLATFORM_KV), createSegmentService(c.env.API_PLATFORM_DB, c.env.API_PLATFORM_KV, now));
}
export function createPublicBuaaClasshopperRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get(ACCESS_POLICY_ROUTE_PATH, async (c) => {
    const version = parseAppVersion(c.req.header(HEADER_APP_VERSION));
    if (version === null) return errorResponse(`缺少或无效的 ${HEADER_APP_VERSION} 请求头，请升级至 ${MIN_ACCESS_POLICY_APP_VERSION} 或以上版本后重试`, 400, { headers: { "Cache-Control": "no-store" } });
    if (!isSupportedAppVersion(version)) return errorResponse(`当前 App 版本过低，请升级至 ${MIN_ACCESS_POLICY_APP_VERSION} 或以上版本后使用白名单功能`, 426, { headers: { "Cache-Control": "no-store" } });
    return successResponse("获取成功", await service(c, () => new Date()).publicPolicy(), 200, { "Cache-Control": "public, max-age=60", Vary: HEADER_APP_VERSION });
  });
  routes.all(ACCESS_POLICY_ROUTE_PATH, () => methodNotAllowed("GET"));
  return routes;
}
export function createAdminBuaaClasshopperRoutes(now: () => Date = () => new Date()) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
  routes.get(ACCESS_POLICY_ROUTE_PATH, async (c) => successResponse("获取成功", await service(c, now).repo.get()));
  routes.put(ACCESS_POLICY_ROUTE_PATH, bodyLimit({ maxSize: 32 * 1024, onError: () => errorResponse("请求体过大", 413) }), async (c) => {
    const value = await service(c, now).replace(parseInput(policyUpdateSchema, await jsonBody(c)));
    console.log(JSON.stringify({ message: "access policy changed", revision: value.revision, actorSubject: c.get("accessIdentity").subject }));
    return successResponse("白名单配置已保存", value);
  });
  routes.all(ACCESS_POLICY_ROUTE_PATH, () => methodNotAllowed("GET, PUT"));
  return routes;
}
