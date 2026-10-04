import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { apiTokenAuth, createApiTokenRoutes } from "../../../http/api-token";
import { ApiError } from "../../../http/errors";
import { errorResponse, methodNotAllowed, successResponse } from "../../../http/response";
import { ssoAuth, type SsoVerifier } from "../../../http/sso-auth";
import type { AppEnv } from "../../../http/types";
import { ReservationRepository } from "./repository";
import { MAX_RESERVATIONS_PER_USER, scheduledTime } from "./checkin-policy";
import { adminReservationQuerySchema, checkinResultSchema, createReservationSchema, reservationQuerySchema } from "./schema";
import { ensureWorkflow, terminateWorkflow } from "./workflow";

const appId = "buaa-classhopper";
const invalid = () => errorResponse("请求数据格式错误", 400);

export function createSsoReservationRoutes(now: () => Date, verifier?: SsoVerifier) {
  const routes = new Hono<AppEnv>();
  routes.use("*", ssoAuth(appId, verifier));
  routes.use("*", async (context, next) => { await next(); context.header("Cache-Control", "no-store"); });
  routes.get("/", zValidator("query", reservationQuerySchema, (result) => {
    if (!result.success) return invalid();
  }), async (context) => successResponse("获取成功",
    await new ReservationRepository(context.env.API_PLATFORM_DB)
      .list(context.get("ssoIdentity").userId, context.req.valid("query"))));
  routes.get("/:id", async (context) => {
    const repository = new ReservationRepository(context.env.API_PLATFORM_DB);
    const id = context.req.param("id")!;
    const reservation = await repository.get(id);
    if (!reservation || reservation.userId !== context.get("ssoIdentity").userId)
      throw new ApiError("预约不存在", 404);
    const events = await repository.events(id);
    return successResponse("获取成功", { ...reservation, events: events ?? [] });
  });
  routes.post("/", bodyLimit({ maxSize: 32 * 1024, onError: () => errorResponse("请求体不能超过 32 KiB", 413) }),
    zValidator("json", createReservationSchema, (result) => {
      if (!result.success) return invalid();
    }), async (context) => {
      const result = await new ReservationRepository(context.env.API_PLATFORM_DB)
        .createOrUpdate(context.get("ssoIdentity").userId, context.req.valid("json"), now());
      if (!result) throw new ApiError("课程上课时间不在可预约范围内", 400);
      if ("limitReached" in result) throw new ApiError(`排队中、签到中或已取消的预约最多 ${MAX_RESERVATIONS_PER_USER} 条`, 409);
      if (result.reservation.status === "CANCELLED") throw new ApiError("预约已取消，请使用恢复接口", 409);
      if (result.reservation.scheduleVersion > 0 && !result.reservation.workflowInstanceId) {
        await ensureWorkflow(context.env, result.reservation.id, result.reservation.scheduleVersion);
      }
      return successResponse(result.created ? "预约已创建" : result.updated ? "预约已更新" : "预约已存在",
        await new ReservationRepository(context.env.API_PLATFORM_DB).get(result.reservation.id), result.created ? 201 : 200);
    });
  routes.post("/:id/cancel", async (context) => successResponse("预约已取消",
    await changeReservation(context.env, context.req.param("id")!, context.get("ssoIdentity").userId, "cancel", now())));
  routes.post("/:id/restore", async (context) => successResponse("预约已恢复",
    await changeReservation(context.env, context.req.param("id")!, context.get("ssoIdentity").userId, "restore", now())));
  routes.delete("/:id", async (context) => successResponse("预约已删除",
    await deleteReservation(context.env, context.req.param("id")!, context.get("ssoIdentity").userId)));
  routes.all("/", () => methodNotAllowed("GET, POST"));
  routes.all("/:id/cancel", () => methodNotAllowed("POST"));
  routes.all("/:id/restore", () => methodNotAllowed("POST"));
  routes.all("/:id", () => methodNotAllowed("GET, DELETE"));
  return routes;
}

export function createAdminReservationRoutes(now: () => Date) {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (context, next) => { await next(); context.header("Cache-Control", "no-store"); });
  routes.get("/", zValidator("query", adminReservationQuerySchema, (result) => {
    if (!result.success) return invalid();
  }), async (context) => successResponse("获取成功",
    await new ReservationRepository(context.env.API_PLATFORM_DB).listAll(context.req.valid("query"))));
  routes.post("/:id/cancel", async (context) => successResponse("预约已取消",
    await changeReservation(context.env, context.req.param("id")!, undefined, "cancel", now())));
  routes.post("/:id/restore", async (context) => successResponse("预约已恢复",
    await changeReservation(context.env, context.req.param("id")!, undefined, "restore", now())));
  routes.post("/:id/checkin", async (context) => successResponse("已触发签到",
    await changeReservation(context.env, context.req.param("id")!, undefined, "checkin", now())));
  routes.get("/:id/events", async (context) => {
    const repository = new ReservationRepository(context.env.API_PLATFORM_DB);
    const id = context.req.param("id")!;
    const items = await repository.events(id);
    if (!items) throw new ApiError("预约不存在", 404);
    return successResponse("获取成功", { items });
  });
  routes.delete("/:id", async (context) => successResponse("预约已删除",
    await deleteReservation(context.env, context.req.param("id")!)));
  routes.all("/", () => methodNotAllowed("GET"));
  routes.all("/:id/cancel", () => methodNotAllowed("POST"));
  routes.all("/:id/restore", () => methodNotAllowed("POST"));
  routes.all("/:id/checkin", () => methodNotAllowed("POST"));
  routes.all("/:id/events", () => methodNotAllowed("GET"));
  routes.all("/:id", () => methodNotAllowed("DELETE"));
  return routes;
}

type ReservationAction = "cancel" | "restore" | "checkin";

async function changeReservation(env: Env, id: string, ownerId: string | undefined, action: ReservationAction, now: Date) {
  const repository = new ReservationRepository(env.API_PLATFORM_DB);
  const current = await repository.get(id);
  if (!current || (ownerId !== undefined && current.userId !== ownerId)) throw new ApiError("预约不存在", 404);
  if (action === "cancel" && current.status === "CANCELLED") return current;
  const allowed = action === "restore" ? current.status === "CANCELLED"
    : ["QUEUED", "FAILED"].includes(current.status);
  if (!allowed) {
    throw new ApiError("当前预约状态不支持此操作", 409);
  }
  if (action !== "cancel" && now.getTime() >= Date.parse(current.course.classEndTime)) {
    throw new ApiError("课程已结束，无法签到", 409);
  }
  const updated = action === "cancel" ? await repository.cancel(id, current.scheduleVersion, now)
    : action === "restore" ? await repository.restore(id, current.scheduleVersion, now,
      new Date(Math.max(now.getTime(), Date.parse(scheduledTime(current.course.classBeginTime)))).toISOString())
      : await repository.triggerNow(id, current.scheduleVersion, now);
  if (!updated) {
    const latest = await repository.get(id);
    if (!latest || (ownerId !== undefined && latest.userId !== ownerId)) throw new ApiError("预约不存在", 404);
    if (action === "cancel" && latest.status === "CANCELLED") return latest;
    throw new ApiError("预约状态已变化，请刷新后重试", 409);
  }
  await terminateWorkflow(env, current.workflowInstanceId);
  if (action !== "cancel") await ensureWorkflow(env, id, updated.scheduleVersion);
  return await repository.get(id) ?? updated;
}

async function deleteReservation(env: Env, id: string, ownerId?: string) {
  const removed = await new ReservationRepository(env.API_PLATFORM_DB).delete(id, ownerId);
  if (!removed) throw new ApiError("预约不存在", 404);
  await terminateWorkflow(env, removed.workflowInstanceId);
  return { id };
}

export function createApiTokenReservationRoutes() {
  const tokenRoutes = createApiTokenRoutes(appId);
  tokenRoutes.get("/:id", "reservations:read", async (context) => {
    const value = await new ReservationRepository(context.env.API_PLATFORM_DB).get(context.req.param("id")!);
    if (!value) throw new ApiError("预约不存在", 404);
    return successResponse("获取成功", value, 200, { "Cache-Control": "no-store" });
  });
  tokenRoutes.routes.post("/:id/result", apiTokenAuth(appId, "reservations:result:write"),
    bodyLimit({ maxSize: 16 * 1024, onError: () => errorResponse("请求体不能超过 16 KiB", 413) }),
    zValidator("json", checkinResultSchema, (result) => {
      if (!result.success) return invalid();
    }), async (context) => {
      const result = context.req.valid("json");
      const id = context.req.param("id")!;
      if (result.reservationId !== id) throw new ApiError("预约 ID 不匹配", 400);
      const value = await new ReservationRepository(context.env.API_PLATFORM_DB).callback(id, result, new Date());
      if (!value) throw new ApiError("预约不存在", 404);
      return successResponse("签到结果已接收", value, 200, { "Cache-Control": "no-store" });
    });
  tokenRoutes.routes.all("/:id", () => methodNotAllowed("GET"));
  tokenRoutes.routes.all("/:id/result", () => methodNotAllowed("POST"));
  return tokenRoutes.routes;
}
