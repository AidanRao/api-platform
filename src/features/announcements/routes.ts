import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { errorResponse, methodNotAllowed, successResponse } from "../../http/response";
import type { AppEnv } from "../../http/types";
import { ossBucketOrigin } from "../../infrastructure/oss";
import { ApiError } from "../../http/errors";
import { AnnouncementRepository } from "./repository";
import type { Announcement } from "./schema";
import { adminQuerySchema, createSchema, paginationSchema, patchSchema, revisionSchema } from "./schema";
import { mutateAnnouncement, requireAnnouncement } from "./service";

const invalid = () => errorResponse("请求数据格式错误", 400);
const jsonLimit = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => errorResponse("请求体不能超过 2 MiB", 413) });
function repository(context: Context<AppEnv>, appId: string) {
  if (!context.env.API_PLATFORM_DB) throw new ApiError("平台数据库尚未配置", 503);
  return new AnnouncementRepository(context.env.API_PLATFORM_DB, appId);
}
function validateCover(c: Context<AppEnv>, cover: string | null | undefined) {
  if (!cover) return;
  const origin = ossBucketOrigin(c.env);
  const prefix = c.env.OSS_PREFIX.replace(/^\/+|\/+$/g, "");
  const base = `${origin}/${prefix}/images/`;
  if (!origin || !cover.startsWith(base) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/.test(cover.slice(base.length))) {
    throw new ApiError("封面必须使用平台图片上传接口返回的地址", 400);
  }
}
function baseRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => { await next(); c.header("Cache-Control", "no-store"); });
  return routes;
}
function audit(c: Context<AppEnv>, appId: string, action: string, id: string, revision?: number) {
  const actor = c.get("accessIdentity");
  console.log(JSON.stringify({ message: "announcement changed", appId, action, id, revision, actorSubject: actor.subject, actorEmail: actor.email }));
}
function publicAnnouncement({ id, title, content, publishedAt, isPinned, coverUrl }: Announcement) {
  return { id, title, content, publishedAt, isPinned, coverUrl };
}
export function createPublicAnnouncementRoutes(appId: string) {
  const routes = baseRoutes();
  routes.get("/", zValidator("query", paginationSchema, (result) => { if (!result.success) return invalid(); }), async (c) => {
    const page = await repository(c, appId).list({ ...c.req.valid("query"), status: "published" });
    return successResponse("获取成功", { ...page, items: page.items.map(publicAnnouncement) });
  });
  routes.get("/:id", async (c) => {
    const value = await requireAnnouncement(repository(c, appId), c.req.param("id"));
    if (value.status !== "published") throw new ApiError("公告不存在", 404);
    return successResponse("获取成功", publicAnnouncement(value));
  });
  routes.all("/", () => methodNotAllowed("GET"));
  routes.all("/:id", () => methodNotAllowed("GET"));
  return routes;
}
export function createAdminAnnouncementRoutes(appId: string, now: () => Date) {
  const routes = baseRoutes();
  routes.get("/", zValidator("query", adminQuerySchema, (result) => { if (!result.success) return invalid(); }), async (c) =>
    successResponse("获取成功", await repository(c, appId).list(c.req.valid("query"))));
  routes.post("/", jsonLimit, zValidator("json", createSchema, (result) => { if (!result.success) return invalid(); }), async (c) => {
    validateCover(c, c.req.valid("json").coverUrl);
    const value = await repository(c, appId).create(c.req.valid("json"), now().toISOString());
    audit(c, appId, "create", value.id, value.revision);
    return successResponse("草稿已创建", value, 201);
  });
  routes.get("/:id", async (c) => successResponse("获取成功", await requireAnnouncement(repository(c, appId), c.req.param("id"))));
  routes.patch("/:id", jsonLimit, zValidator("json", patchSchema, (result) => { if (!result.success) return invalid(); }), async (c) => {
    const input = c.req.valid("json");
    validateCover(c, input.coverUrl);
    const value = await mutateAnnouncement(repository(c, appId), c.req.param("id"), input.revision, "patch", now(), input);
    audit(c, appId, "patch", c.req.param("id"), value?.revision);
    return successResponse("公告已保存", value);
  });
  for (const action of ["publish", "unpublish", "delete"] as const) {
    const path = action === "delete" ? "/:id" : `/:id/${action}`;
    routes.on(action === "delete" ? "DELETE" : "POST", path, jsonLimit,
      zValidator("json", revisionSchema, (result) => { if (!result.success) return invalid(); }), async (c) => {
        const value = await mutateAnnouncement(repository(c, appId), c.req.param("id")!, c.req.valid("json").revision, action, now());
        audit(c, appId, action, c.req.param("id")!, value?.revision);
        return successResponse(action === "delete" ? "公告已删除" : action === "publish" ? "公告已发布" : "公告已下架", value);
      });
  }
  routes.all("/", () => methodNotAllowed("GET, POST"));
  routes.all("/:id", () => methodNotAllowed("GET, PATCH, DELETE"));
  routes.all("/:id/publish", () => methodNotAllowed("POST"));
  routes.all("/:id/unpublish", () => methodNotAllowed("POST"));
  return routes;
}
