import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  errorResponse,
  methodNotAllowed,
  successResponse,
} from "../../../http/response";
import { ssoAuth, type SsoVerifier } from "../../../http/sso-auth";
import type { AppEnv } from "../../../http/types";
import { jsonBody, parseInput } from "../../../http/validation";
import { authorizationSchema, dateSchema, signInSchema } from "./schema";
import { IclassService } from "./service";

export function createIclassRoutes(now: () => Date, verifier?: SsoVerifier) {
  const routes = new Hono<AppEnv>();
  for (const path of ["/authorization", "/course-schedules", "/sign-ins"]) {
    routes.use(
      path,
      ssoAuth("buaa-classhopper", verifier),
      async (c, next) => {
        await next();
        c.header("Cache-Control", "no-store");
      },
      bodyLimit({
        maxSize: 16 * 1024,
        onError: () => errorResponse("请求体过大", 413),
      }),
    );
  }
  routes.get("/authorization", async (c) =>
    successResponse(
      "获取成功",
      await new IclassService(c.env, now).authorization(
        c.get("ssoIdentity").userId,
      ),
    ),
  );
  routes.put("/authorization", async (c) => {
    const input = parseInput(authorizationSchema, await jsonBody(c));
    return successResponse(
      "授权成功",
      await new IclassService(c.env, now).authorize(
        c.get("ssoIdentity").userId,
        input.loginName,
      ),
    );
  });
  routes.delete("/authorization", async (c) => {
    await new IclassService(c.env, now).repository.remove(
      c.get("ssoIdentity").userId,
    );
    return successResponse("授权已撤销", {
      authorized: false,
      authorizedAt: null,
    });
  });
  routes.get("/course-schedules", async (c) => {
    const date = parseInput(dateSchema, c.req.query("date"));
    return successResponse(
      "获取成功",
      await new IclassService(c.env, now).schedules(
        c.get("ssoIdentity").userId,
        date,
      ),
    );
  });
  routes.post("/sign-ins", async (c) => {
    const input = parseInput(signInSchema, await jsonBody(c));
    return successResponse(
      "签到成功",
      await new IclassService(c.env, now).sign(
        c.get("ssoIdentity").userId,
        input,
      ),
    );
  });
  routes.all("/authorization", () => methodNotAllowed("GET, PUT, DELETE"));
  routes.all("/course-schedules", () => methodNotAllowed("GET"));
  routes.all("/sign-ins", () => methodNotAllowed("POST"));
  return routes;
}
