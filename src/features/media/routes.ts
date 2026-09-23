import { Hono } from "hono";
import type { AppEnv } from "../../http/types";
import { methodNotAllowed, successResponse } from "../../http/response";
import { uploadImage } from "../../infrastructure/oss";

/** Shared image uploads for every app; consumers include announcements and future ads. */
export function createMediaRoutes(now: () => Date) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  routes.post("/images", async (context) => successResponse(
    "上传成功",
    await uploadImage(context.env, context.req.raw, now()),
    201,
  ));
  routes.all("/images", () => methodNotAllowed("POST"));
  return routes;
}
