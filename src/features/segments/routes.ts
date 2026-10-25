import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../http/types";
import { errorResponse, methodNotAllowed, successResponse } from "../../http/response";
import { jsonBody, parseInput } from "../../http/validation";
import { createSegmentService } from "./service";
import * as s from "./schema";

export function createSegmentRoutes(now: () => Date) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
  routes.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => errorResponse("请求体不能超过 2 MiB", 413) }));
  const service = (c: Context<AppEnv>) => createSegmentService(c.env.API_PLATFORM_DB, c.env.API_PLATFORM_KV, now);
  const audit = (c: Context<AppEnv>, action: string) => console.log(JSON.stringify({ message: "segment changed", action, actorSubject: c.get("accessIdentity").subject }));
  routes.get("/", async (c) => successResponse("获取成功", await service(c).repo.list(parseInput(s.segmentQuerySchema, c.req.query()))));
  routes.post("/", async (c) => {
    const value = await service(c).create(parseInput(s.segmentInputSchema, await jsonBody(c)));
    audit(c, "create"); return successResponse("人群已创建", value, 201);
  });
  routes.get("/:id", async (c) => successResponse("获取成功", await service(c).get(parseInput(s.segmentIdSchema, c.req.param("id")))));
  routes.put("/:id", async (c) => {
    const input = parseInput(s.segmentUpdateSchema, await jsonBody(c));
    const value = await service(c).update(parseInput(s.segmentIdSchema, c.req.param("id")), input.revision, input);
    audit(c, "update"); return successResponse("人群已保存", value);
  });
  routes.delete("/:id", async (c) => {
    await service(c).delete(parseInput(s.segmentIdSchema, c.req.param("id")), parseInput(s.revisionSchema, await jsonBody(c)).revision);
    audit(c, "delete"); return successResponse("人群已删除", null);
  });
  routes.all("/", () => methodNotAllowed("GET, POST"));
  routes.all("/:id", () => methodNotAllowed("GET, PUT, DELETE"));
  return routes;
}
