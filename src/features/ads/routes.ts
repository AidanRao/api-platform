import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../../http/types";
import { ApiError } from "../../http/errors";
import {
  successResponse,
  errorResponse,
  methodNotAllowed,
} from "../../http/response";
import { AdsRepository } from "./repository";
import { AdsService, requireRecord } from "./service";
import * as schema from "./schema";

function routes() {
  const router = new Hono<AppEnv>();
  router.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  router.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: () => errorResponse("请求体不能超过 32 KiB", 413),
    }),
  );
  return router;
}
function service(c: Context<AppEnv>, now: () => Date) {
  if (!c.env.API_PLATFORM_DB) throw new ApiError("平台数据库尚未配置", 503);
  return new AdsService(new AdsRepository(c.env.API_PLATFORM_DB), c.env, now);
}
function parse<T extends z.ZodType>(validator: T, value: unknown): z.output<T> {
  const result = validator.safeParse(value);
  if (!result.success)
    throw new ApiError(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；"),
      400,
    );
  return result.data;
}
async function body(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new ApiError("请求体不是合法的 JSON", 400);
    throw error;
  }
}
const query = (c: Context<AppEnv>) => parse(schema.querySchema, c.req.query());
function audit(c: Context<AppEnv>) {
  console.log(
    JSON.stringify({
      message: "ads changed",
      method: c.req.method,
      path: c.req.path,
      actorSubject: c.get("accessIdentity").subject,
    }),
  );
}

export function createPlatformAdsRoutes(now: () => Date) {
  const router = routes();
  router.get("/campaigns", async (c) =>
    successResponse("获取成功", await service(c, now).repo.campaigns(query(c))),
  );
  router.post("/campaigns", async (c) => {
    const value = await service(c, now).createCampaign(
      parse(schema.campaignCreateSchema, await body(c)),
    );
    audit(c);
    return successResponse("已创建", value, 201);
  });
  router.get("/campaigns/:id", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(await service(c, now).repo.campaign(c.req.param("id"))),
    ),
  );
  router.patch("/campaigns/:id", async (c) => {
    const value = await service(c, now).updateCampaign(
      c.req.param("id"),
      parse(schema.campaignPatchSchema, await body(c)),
    );
    audit(c);
    return successResponse("已保存", value);
  });
  router.delete("/campaigns/:id", async (c) => {
    await service(c, now).deleteCampaign(
      c.req.param("id"),
      parse(schema.revisionSchema, await body(c)).revision,
    );
    audit(c);
    return successResponse("已删除", null);
  });
  router.all("/campaigns", () => methodNotAllowed("GET, POST"));
  router.all("/campaigns/:id", () => methodNotAllowed("GET, PATCH, DELETE"));
  router.get("/creatives", async (c) =>
    successResponse("获取成功", await service(c, now).repo.creatives(query(c))),
  );
  router.post("/creatives", async (c) => {
    const value = await service(c, now).createCreative(
      parse(schema.creativeCreateSchema, await body(c)),
    );
    audit(c);
    return successResponse("已创建", value, 201);
  });
  router.get("/creatives/:id", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(await service(c, now).repo.creative(c.req.param("id"))),
    ),
  );
  router.patch("/creatives/:id", async (c) => {
    const value = await service(c, now).updateCreative(
      c.req.param("id"),
      parse(schema.creativePatchSchema, await body(c)),
    );
    audit(c);
    return successResponse("已保存", value);
  });
  router.delete("/creatives/:id", async (c) => {
    await service(c, now).deleteCreative(
      c.req.param("id"),
      parse(schema.revisionSchema, await body(c)).revision,
    );
    audit(c);
    return successResponse("已删除", null);
  });
  router.all("/creatives", () => methodNotAllowed("GET, POST"));
  router.all("/creatives/:id", () => methodNotAllowed("GET, PATCH, DELETE"));
  router.get("/creatives/:id/versions", async (c) => {
    const repo = service(c, now).repo;
    requireRecord(await repo.creative(c.req.param("id")));
    return successResponse(
      "获取成功",
      await repo.versions(c.req.param("id"), query(c)),
    );
  });
  router.get("/creatives/:id/versions/:version", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(
        await service(c, now).repo.version(
          c.req.param("id"),
          parse(z.coerce.number().int().positive(), c.req.param("version")),
        ),
      ),
    ),
  );
  router.get("/creatives/:id/placements", async (c) => {
    const repo = service(c, now).repo;
    requireRecord(await repo.creative(c.req.param("id")));
    return successResponse(
      "获取成功",
      await repo.placements({ ...query(c), creativeId: c.req.param("id") }),
    );
  });
  router.get("/campaigns/:id/placements", async (c) => {
    const repo = service(c, now).repo;
    requireRecord(await repo.campaign(c.req.param("id")));
    return successResponse(
      "获取成功",
      await repo.placements({ ...query(c), campaignId: c.req.param("id") }),
    );
  });
  for (const path of [
    "/creatives/:id/versions",
    "/creatives/:id/versions/:version",
    "/creatives/:id/placements",
    "/campaigns/:id/placements",
  ])
    router.all(path, () => methodNotAllowed("GET"));
  return router;
}

export function createAppAdsRoutes(appId: string, now: () => Date) {
  const router = routes();
  router.get("/slots", async (c) =>
    successResponse(
      "获取成功",
      await service(c, now).repo.slots(appId, query(c)),
    ),
  );
  router.post("/slots", async (c) => {
    const value = await service(c, now).createSlot(
      appId,
      parse(schema.slotCreateSchema, await body(c)),
    );
    audit(c);
    return successResponse("已创建", value, 201);
  });
  router.get("/slots/:key", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(await service(c, now).repo.slot(appId, c.req.param("key"))),
    ),
  );
  router.patch("/slots/:key", async (c) => {
    const value = await service(c, now).updateSlot(
      appId,
      c.req.param("key"),
      parse(schema.slotPatchSchema, await body(c)),
    );
    audit(c);
    return successResponse("已保存", value);
  });
  router.delete("/slots/:key", async (c) => {
    await service(c, now).deleteSlot(
      appId,
      c.req.param("key"),
      parse(schema.revisionSchema, await body(c)).revision,
    );
    audit(c);
    return successResponse("已删除", null);
  });
  router.all("/slots", () => methodNotAllowed("GET, POST"));
  router.all("/slots/:key", () => methodNotAllowed("GET, PATCH, DELETE"));
  router.get("/placements", async (c) =>
    successResponse(
      "获取成功",
      await service(c, now).repo.placements(query(c), appId),
    ),
  );
  router.post("/placements", async (c) => {
    const value = await service(c, now).createPlacement(
      appId,
      parse(schema.placementCreateSchema, await body(c)),
    );
    audit(c);
    return successResponse("已创建", value, 201);
  });
  router.get("/placements/:id", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(
        await service(c, now).repo.placement(appId, c.req.param("id")),
      ),
    ),
  );
  router.patch("/placements/:id", async (c) => {
    const value = await service(c, now).updatePlacement(
      appId,
      c.req.param("id"),
      parse(schema.placementPatchSchema, await body(c)),
    );
    audit(c);
    return successResponse("已保存", value);
  });
  router.delete("/placements/:id", async (c) => {
    await service(c, now).deletePlacement(
      appId,
      c.req.param("id"),
      parse(schema.revisionSchema, await body(c)).revision,
    );
    audit(c);
    return successResponse("已删除", null);
  });
  router.all("/placements", () => methodNotAllowed("GET, POST"));
  router.all("/placements/:id", () => methodNotAllowed("GET, PATCH, DELETE"));
  return router;
}

export function createPublicAdsRoutes(appId: string, now: () => Date) {
  const router = routes();
  router.get("/slots/:slotKey", async (c) =>
    successResponse(
      "获取成功",
      requireRecord(
        await service(c, now).repo.delivery(
          appId,
          c.req.param("slotKey"),
          now().toISOString(),
        ),
        "广告位",
      ),
    ),
  );
  router.all("/slots/:slotKey", () => methodNotAllowed("GET"));
  return router;
}
