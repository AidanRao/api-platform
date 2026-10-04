import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { APPS, type AppDefinition } from "./apps/registry";
import { mountAppRoutes } from "./apps/routes";
import { ApiError } from "./http/errors";
import {
  accessAuth,
  type AccessVerifier,
  verifyAccessRequest,
} from "./http/access-auth";
import { serveAdminAsset } from "./http/admin-assets";
import { createMediaRoutes } from "./features/media/routes";
import { methodNotAllowed, successResponse, errorResponse } from "./http/response";
import type { AppEnv } from "./http/types";
import type { SsoVerifier } from "./http/sso-auth";

export function createApp(
  verifyAccess: AccessVerifier = verifyAccessRequest,
  now: () => Date = () => new Date(),
  apps: readonly AppDefinition[] = APPS,
  verifySso?: SsoVerifier,
): Hono<AppEnv> {
  const application = new Hono<AppEnv>();

  application.use("/admin/*", accessAuth(verifyAccess));
  application.use("/api/admin/*", accessAuth(verifyAccess));
  application.all("/admin/*", (context) => serveAdminAsset(context, apps));
  application.get("/api/admin/apps", () => successResponse("获取成功", { items: apps.map(({ id, name }) => ({ id, name })) }, 200, { "Cache-Control": "no-store" }));
  application.all("/api/admin/apps", () => methodNotAllowed("GET"));
  application.route("/api/admin/media", createMediaRoutes(now));
  mountAppRoutes(application, apps, now, verifySso);

  application.notFound(() =>
    errorResponse("接口不存在", 404, {
      headers: { "Cache-Control": "no-store" },
    }),
  );

  application.onError((error, context) => {
    if (error instanceof ApiError) {
      return errorResponse(error.message, error.status, {
        data: error.data,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof HTTPException && error.status === 400) {
      return errorResponse("请求体不是合法的 JSON", 400, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error(
      JSON.stringify({
        message: "request failed",
        method: context.req.method,
        path: context.req.path,
        error: error.message,
      }),
    );
    return errorResponse("服务器内部错误", 500, {
      headers: { "Cache-Control": "no-store" },
    });
  });

  return application;
}

export const app = createApp();
