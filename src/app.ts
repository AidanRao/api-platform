import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  ADMIN_BUAA_CLASSHOPPER_BASE_PATH,
  createAdminBuaaClasshopperRoutes,
  createPublicBuaaClasshopperRoutes,
  PUBLIC_BUAA_CLASSHOPPER_BASE_PATH,
} from "./domains/buaa-classhopper/routes";
import {
  accessAuth,
  type AccessVerifier,
  verifyAccessRequest,
} from "./http/access-auth";
import { serveAdminAsset } from "./http/admin-assets";
import { errorResponse } from "./http/response";
import type { AppEnv } from "./http/types";

export function createApp(
  verifyAccess: AccessVerifier = verifyAccessRequest,
  now: () => Date = () => new Date(),
): Hono<AppEnv> {
  const application = new Hono<AppEnv>();

  application.use("/admin/*", accessAuth(verifyAccess));
  application.use("/api/admin/*", accessAuth(verifyAccess));
  application.route(
    PUBLIC_BUAA_CLASSHOPPER_BASE_PATH,
    createPublicBuaaClasshopperRoutes(),
  );
  application.all("/admin/*", serveAdminAsset);
  application.route(
    ADMIN_BUAA_CLASSHOPPER_BASE_PATH,
    createAdminBuaaClasshopperRoutes(now),
  );

  application.notFound(() =>
    errorResponse("接口不存在", 404, {
      headers: { "Cache-Control": "no-store" },
    }),
  );

  application.onError((error, context) => {
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
