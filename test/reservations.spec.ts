import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import migration from "../migrations/0004_reservations_and_api_tokens.sql?raw";
import { createApp } from "../src/app";
import { defineApps } from "../src/apps/registry";
import { AccessDeniedError } from "../src/http/access-auth";
import { createSsoVerifier } from "../src/http/sso-auth";
import { generateApiToken, hashApiToken } from "../src/http/api-token";
import { ReservationRepository } from "../src/domains/buaa-classhopper/reservations/repository";
import { executeCheckin } from "../src/domains/buaa-classhopper/reservations/checkin-service";
import { createReservationSchema } from "../src/domains/buaa-classhopper/reservations/schema";
import { reconcileWorkflows } from "../src/domains/buaa-classhopper/reservations/workflow";

const base = "/api/buaa-classhopper/reservations";
const detailBase = "/api/token/buaa-classhopper/reservations";
const tokenAdmin = "/api/admin/buaa-classhopper/api-tokens";
const reservationAdmin = "/api/admin/buaa-classhopper/reservations";
const now = new Date();
const classBegin = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
const classEnd = new Date(classBegin.getTime() + 90 * 60_000);
const tokenExpiry = new Date(now.getTime() + 365 * 24 * 60 * 60_000).toISOString();
const sso = async (_request: Request, _issuer: string, _appId: string) => ({ userId: "user-1", clientId: "android" });
const app = createApp(async () => ({ email: "admin@example.com", subject: "admin-1" }), () => now, undefined, sso);
const course = {
  id: 12345, courseId: 678, courseName: "高等数学", courseNum: "D211042002",
  classroomName: "B118",
  classBeginTime: classBegin.toISOString(), classEndTime: classEnd.toISOString(),
};
const input = { loginName: "student123", studentId: "23370001", studentName: "张三", course };
function call(path: string, method = "GET", body?: unknown, token?: string, target = app) {
  return target.request(`https://example.com${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
async function data<T>(response: Response): Promise<T> {
  return (await response.json() as { data: T }).data;
}

beforeAll(async () => {
  await env.API_PLATFORM_DB.batch(migration.split(";").filter((sql) => sql.trim()).map((sql) => env.API_PLATFORM_DB.prepare(sql)));
});
beforeEach(async () => {
  await env.API_PLATFORM_DB.prepare("DELETE FROM buaa_classhopper_reservations").run();
  await env.API_PLATFORM_DB.prepare("DELETE FROM api_tokens").run();
});

describe("reservations and API tokens", () => {
  it("publishes the app-scoped permission catalog to authenticated administrators", async () => {
    const response = await call(`${tokenAdmin}/permissions`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await data(response)).toEqual({ groups: [{
      code: "reservations", name: "签到预约", permissions: [
        { code: "reservations:read", name: "读取签到预约详情" },
      ],
    }] });
    const apps = defineApps([{ id: "buaa-classhopper", name: "BUAA" }, { id: "other-app", name: "Other" }]);
    const multi = createApp(async () => ({ email: null, subject: "admin" }), () => now, apps, sso);
    expect(await data(await call("/api/admin/other-app/api-tokens/permissions", "GET", undefined, undefined, multi)))
      .toEqual({ groups: [] });
    expect((await call(`${tokenAdmin}/permissions`, "POST")).status).toBe(405);
    const denied = createApp(async () => { throw new AccessDeniedError("拒绝访问"); }, () => now, apps, sso);
    expect((await call(`${tokenAdmin}/permissions`, "GET", undefined, undefined, denied)).status).toBe(401);
  });

  it("records the submitted schedule and each check-in attempt for administrators", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const first = await repository.beginAttempt(created.id, created.scheduleVersion, now);
    expect(first?.activeAttemptId).toBeTruthy();
    await repository.completeAttempt(created.id, {
      reservationId: created.id, attemptId: first!.activeAttemptId!, status: "FAILED",
      code: 1, message: "第一次失败", data: {},
    }, now);
    const second = await repository.beginAttempt(created.id, created.scheduleVersion, new Date(now.getTime() + 30_000));
    expect(second?.activeAttemptId).not.toBe(first?.activeAttemptId);
    await repository.completeAttempt(created.id, {
      reservationId: created.id, attemptId: second!.activeAttemptId!, status: "SUCCESS",
      code: 0, message: "签到成功", data: {},
    }, new Date(now.getTime() + 31_000));
    const response = await call(`${reservationAdmin}/${created.id}/events`);
    expect(response.status).toBe(200);
    const events = await data<{ items: { kind: string; attemptNumber: number | null; referenceId: string | null }[] }>(response);
    expect(events.items.map((event) => event.kind)).toEqual([
      "SUBMITTED", "SCHEDULED", "ATTEMPT_STARTED", "RESULT_FAILED", "ATTEMPT_STARTED", "RESULT_SUCCESS",
    ]);
    expect(events.items.filter((event) => event.kind === "ATTEMPT_STARTED").map((event) => event.attemptNumber)).toEqual([1, 2]);
    expect(events.items.at(-1)?.referenceId).toBe(second?.activeAttemptId);
    expect((await call(`${reservationAdmin}/missing/events`)).status).toBe(404);
  });

  it("returns the authenticated user's reservation with its ordered events", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const attempt = await repository.beginAttempt(created.id, created.scheduleVersion, now);
    await repository.completeAttempt(created.id, {
      reservationId: created.id, attemptId: attempt!.activeAttemptId!, status: "SUCCESS",
      code: 0, message: "签到成功", data: {},
    }, new Date(now.getTime() + 1_000));

    const response = await call(`${base}/${created.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { code: number; msg: string; data: {
      id: string; userId: string; events: { kind: string; occurredAt: string }[];
    } };
    expect(body).toMatchObject({ code: 1, msg: "获取成功", data: { id: created.id, userId: "user-1" } });
    expect(body.data.events.map((event) => event.kind)).toEqual([
      "SUBMITTED", "SCHEDULED", "ATTEMPT_STARTED", "RESULT_SUCCESS",
    ]);
    expect(body.data.events.at(-1)?.occurredAt).toBe(new Date(now.getTime() + 1_000).toISOString());

    const other = createApp(async () => ({ email: null, subject: null }), () => now,
      undefined, async () => ({ userId: "user-2", clientId: "android" }));
    expect((await call(`${base}/${created.id}`, "GET", undefined, undefined, other)).status).toBe(404);
    expect((await call(`${base}/missing`)).status).toBe(404);
    expect((await call(`${base}/${created.id}`, "PUT")).status).toBe(405);
    expect((await call(`${base}/${created.id}/events`)).status).toBe(404);
  });

  it("creates, updates, and lists only the authenticated user's reservations", async () => {
    const created = await call(base, "POST", input);
    expect(created.status).toBe(201);
    const first = await data<{ id: string; userId: string; studentId: string; studentName: string; course: typeof course }>(created);
    expect(first.id).toMatch(/^RSV-\d{8}-[0-9A-Z]{10}$/);
    expect(first.userId).toBe("user-1");
    expect(first.studentId).toBe(input.studentId);
    expect(first.studentName).toBe(input.studentName);
    expect(first.course).toMatchObject({ id: "12345", courseId: "678" });
    expect(first.course.classroomName).toBe("B118");
    expect(first.course.classBeginTime).toBe(classBegin.toISOString());
    const repeated = await call(base, "POST", {
      ...input, studentId: "23370002", studentName: "李四", course: { ...course, courseName: "高等数学（新）" },
    });
    expect(repeated.status).toBe(200);
    const updated = await data<{ id: string; studentId: string; studentName: string; course: typeof course }>(repeated);
    expect(updated.id).toBe(first.id);
    expect(updated.studentId).toBe("23370002");
    expect(updated.studentName).toBe("李四");
    expect(updated.course.courseName).toBe("高等数学（新）");
    const rescheduled = await data<{ id: string; scheduleVersion: number; nextAttemptAt: string }>(await call(base, "POST", {
      ...input, studentId: "23370002", studentName: "李四",
      course: { ...course, classBeginTime: new Date(classBegin.getTime() + 30 * 60_000).toISOString(),
        classEndTime: new Date(classEnd.getTime() + 30 * 60_000).toISOString() },
    }));
    expect(rescheduled).toMatchObject({ id: first.id, scheduleVersion: 2 });
    expect(new Date(rescheduled.nextAttemptAt).getTime()).toBeGreaterThan(new Date(updated.course.classBeginTime).getTime());
    const stored = await env.API_PLATFORM_DB.prepare("SELECT student_name AS studentName FROM buaa_classhopper_reservations WHERE id = ?")
      .bind(first.id).first<{ studentName: string }>();
    expect(stored?.studentName).toBe("李四");
    const page = await data<{ items: { studentName: string; course: { classroomName: string } }[]; page: number; pageSize: number; total: number }>(await call(base));
    expect(page).toMatchObject({ page: 1, pageSize: 10, total: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.studentName).toBe("李四");
    expect(page.items[0]?.course.classroomName).toBe("B118");
    const other = createApp(async () => ({ email: null, subject: null }), () => now,
      undefined, async () => ({ userId: "user-2", clientId: "android" }));
    expect((await data<{ total: number }>(await call(base, "GET", undefined, undefined, other))).total).toBe(0);
    expect((await call(base, "POST", {
      ...input, course: { ...course, classroomName: undefined },
    }, undefined, other)).status).toBe(400);
  });

  it("handles concurrent duplicate creates and the reservation cutoff", async () => {
    const responses = await Promise.all([call(base, "POST", input), call(base, "POST", input)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const count = await env.API_PLATFORM_DB.prepare("SELECT COUNT(*) AS count FROM buaa_classhopper_reservations").first<{ count: number }>();
    expect(count?.count).toBe(1);
    const late = createApp(async () => ({ email: null, subject: null }),
      () => new Date(classBegin.getTime() - 10 * 60_000), undefined, sso);
    const repeated = await call(base, "POST", { ...input, studentId: "changed", studentName: "王五" }, undefined, late);
    expect(repeated.status).toBe(200);
    expect(await data<{ studentId: string; studentName: string }>(repeated))
      .toMatchObject({ studentId: input.studentId, studentName: input.studentName });
    const forgedTime = await call(base, "POST", {
      ...input, studentId: "changed", studentName: "王五", course: { ...course,
        classBeginTime: new Date(classBegin.getTime() + 24 * 60 * 60_000).toISOString(),
        classEndTime: new Date(classEnd.getTime() + 24 * 60 * 60_000).toISOString() },
    }, undefined, late);
    expect(await data<{ studentId: string; studentName: string }>(forgedTime))
      .toMatchObject({ studentId: input.studentId, studentName: input.studentName });
    const fresh = await call(base, "POST", { ...input, course: { ...course, id: 999 } }, undefined, late);
    expect(fresh.status).toBe(400);
  });

  it("retries an ID collision without changing another reservation", async () => {
    const original = await data<{ id: string }>(await call(base, "POST", input));
    const nextId = `${original.id.slice(0, -10)}0000000000`;
    const candidates = [original.id, nextId];
    const repository = new ReservationRepository(env.API_PLATFORM_DB, () => candidates.shift()!);
    const created = await repository.createOrUpdate("user-2", createReservationSchema.parse({
      ...input, course: { ...course, id: 98765 },
    }), now);
    expect(created).toMatchObject({ created: true, reservation: { id: nextId, userId: "user-2" } });
    expect(await repository.get(original.id)).toMatchObject({ userId: "user-1" });
    expect(candidates).toEqual([]);

    const exhausted = new ReservationRepository(env.API_PLATFORM_DB, () => original.id);
    await expect(exhausted.createOrUpdate("user-3", createReservationSchema.parse({
      ...input, course: { ...course, id: 56789 },
    }), now)).rejects.toThrow("Unable to generate a unique reservation ID");
  });

  it("validates request bodies and pagination", async () => {
    expect((await call(base, "POST", { ...input, studentName: "   " })).status).toBe(400);
    expect((await call(base, "POST", { ...input, course: { ...course, classEndTime: course.classBeginTime } })).status).toBe(400);
    expect((await call(`${base}?pageSize=101`)).status).toBe(400);
    expect((await createApp().request(`https://example.com${base}`, undefined, env)).status).toBe(401);
  });

  it("accepts courses through day 30 and rejects later start times, including updates", async () => {
    const begin = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const atBoundary = { ...input, course: { ...course,
      classBeginTime: begin.toISOString(), classEndTime: new Date(begin.getTime() + 90 * 60_000).toISOString(),
    } };
    const created = await call(base, "POST", atBoundary);
    expect(created.status).toBe(201);
    const beyondWindow = { ...atBoundary, course: { ...atBoundary.course,
      classBeginTime: new Date(begin.getTime() + 1).toISOString(),
    } };
    expect((await call(base, "POST", beyondWindow)).status).toBe(400);
    expect((await call(base, "POST", { ...beyondWindow, course: { ...beyondWindow.course, id: 98765 } })).status).toBe(400);
    const count = await data<{ total: number }>(await call(base));
    expect(count.total).toBe(1);
  });

  it("limits concurrent creates by countable status and frees slots after deletion or completion", async () => {
    const ids: string[] = [];
    for (let id = 1; id < 10; id += 1) {
      const response = await call(base, "POST", { ...input, course: { ...course, id } });
      expect(response.status).toBe(201);
      ids.push((await data<{ id: string }>(response)).id);
    }
    const responses = await Promise.all([10, 11].map((id) =>
      call(base, "POST", { ...input, course: { ...course, id } })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await data<{ total: number }>(await call(base))).total).toBe(10);
    expect((await call(base, "POST", { ...input, course: { ...course, id: 2 } })).status).toBe(200);
    expect((await call(`${base}/${ids[0]}/cancel`, "POST")).status).toBe(200);
    expect((await call(base, "POST", { ...input, course: { ...course, id: 12 } })).status).toBe(409);
    const anotherUser = createApp(async () => ({ email: null, subject: null }), () => now,
      undefined, async () => ({ userId: "user-2", clientId: "android" }));
    expect((await call(base, "POST", input, undefined, anotherUser)).status).toBe(201);
    expect((await call(`${base}/${ids[0]}`, "DELETE")).status).toBe(200);
    expect((await call(base, "POST", { ...input, course: { ...course, id: 12 } })).status).toBe(201);
    await env.API_PLATFORM_DB.prepare("UPDATE buaa_classhopper_reservations SET status = 'FAILED' WHERE id = ?")
      .bind(ids[1]).run();
    expect((await call(base, "POST", { ...input, course: { ...course, id: 13 } })).status).toBe(201);
    await env.API_PLATFORM_DB.prepare("UPDATE buaa_classhopper_reservations SET status = 'SUCCESS' WHERE id = ?")
      .bind(ids[2]).run();
    expect((await call(base, "POST", { ...input, course: { ...course, id: 14 } })).status).toBe(201);
    expect((await data<{ total: number }>(await call(base))).total).toBe(12);
  });

  it("lets Access administrators page through all users' reservations", async () => {
    const anotherUser = createApp(async () => ({ email: null, subject: "admin-1" }), () => now,
      undefined, async () => ({ userId: "user-2", clientId: "android" }));
    const firstReservation = await data<{ id: string }>(await call(base, "POST", input));
    await call(base, "POST", {
      ...input, studentId: "23370002", studentName: "李四",
      course: { ...course, id: 12346, courseName: "线性代数" },
    }, undefined, anotherUser);
    await env.API_PLATFORM_DB.prepare("UPDATE buaa_classhopper_reservations SET status = 'SUCCESS' WHERE user_id = 'user-2'").run();
    const first = await call(`${reservationAdmin}?page=1&pageSize=1`);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const page1 = await data<{ items: { id: string; userId: string }[]; total: number; pageSize: number }>(first);
    const page2 = await data<{ items: { id: string; userId: string }[]; total: number }>(await call(`${reservationAdmin}?page=2&pageSize=1`));
    expect(page1).toMatchObject({ total: 2, pageSize: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items].map((item) => item.userId)))
      .toEqual(new Set(["user-1", "user-2"]));
    const byStudent = await data<{ items: { userId: string; studentName: string }[]; total: number }>(await call(`${reservationAdmin}?studentId=23370002`));
    expect(byStudent).toMatchObject({ total: 1, items: [{ userId: "user-2", studentName: "李四" }] });
    for (const term of [firstReservation.id.slice(-6), "张三", "370001", "高等数"]) {
      const found = await data<{ items: { id: string }[]; total: number }>(
        await call(`${reservationAdmin}?search=${encodeURIComponent(term)}`));
      expect(found).toMatchObject({ total: 1, items: [{ id: firstReservation.id }] });
    }
    const literalWildcard = await data<{ items: unknown[]; total: number }>(
      await call(`${reservationAdmin}?search=%25`));
    expect(literalWildcard).toMatchObject({ total: 0, items: [] });
    const byStatus = await data<{ items: { userId: string }[]; total: number }>(await call(`${reservationAdmin}?status=SUCCESS`));
    expect(byStatus).toMatchObject({ total: 1, items: [{ userId: "user-2" }] });
    const combined = await data<{ items: unknown[]; total: number }>(await call(`${reservationAdmin}?studentId=23370001&status=SUCCESS`));
    expect(combined).toMatchObject({ total: 0, items: [] });
    const searchedStatus = await data<{ items: { userId: string }[]; total: number }>(
      await call(`${reservationAdmin}?search=${encodeURIComponent("线性")}&status=SUCCESS`));
    expect(searchedStatus).toMatchObject({ total: 1, items: [{ userId: "user-2" }] });
    expect((await call(`${reservationAdmin}?status=UNKNOWN`)).status).toBe(400);
    expect((await call(`${reservationAdmin}?studentId=`)).status).toBe(400);
    expect((await call(`${reservationAdmin}?search=`)).status).toBe(400);
    expect((await call(`${reservationAdmin}?search=${"a".repeat(201)}`)).status).toBe(400);
    expect((await call(`${reservationAdmin}?pageSize=101`)).status).toBe(400);
    expect((await call(reservationAdmin, "POST")).status).toBe(405);
    expect((await createApp().request(`https://example.com${reservationAdmin}`, undefined, env)).status).toBe(401);
  });

  it("issues a one-time token, scopes it to the app, and revokes it", async () => {
    const created = await call(base, "POST", input);
    const reservation = await data<{ id: string }>(created);
    expect((await call(`${detailBase}/${reservation.id}`)).status).toBe(401);
    expect((await call(tokenAdmin, "POST", { name: "bad", permissions: ["unknown"] })).status).toBe(400);
    const response = await call(tokenAdmin, "POST", { name: "iClass service", permissions: ["reservations:read"] });
    expect(response.status).toBe(201);
    const issued = await data<{ id: string; token: string; permissions: string[] }>(response);
    expect(issued.token).toMatch(/^apt_/);
    expect(issued.permissions).toEqual(["reservations:read"]);
    const detail = await call(`${detailBase}/${reservation.id}`, "GET", undefined, issued.token);
    expect(detail.status).toBe(200);
    expect(await data<{ studentName: string; course: typeof course }>(detail)).toMatchObject({
      studentName: input.studentName,
      course: { id: "12345", courseId: "678", courseName: course.courseName },
    });
    const active = await new ReservationRepository(env.API_PLATFORM_DB).beginAttempt(reservation.id, 1, now);
    expect(active?.status).toBe("IN_PROGRESS");
    expect(await data<{ status: string; activeAttemptId: string }>(
      await call(`${detailBase}/${reservation.id}`, "GET", undefined, issued.token)))
      .toMatchObject({ status: "IN_PROGRESS", activeAttemptId: active?.activeAttemptId });
    const listed = await data<{ items: unknown[] }>(await call(tokenAdmin));
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    const otherApps = defineApps([{ id: "buaa-classhopper", name: "BUAA" }, { id: "other-app", name: "Other" }]);
    const multi = createApp(async () => ({ email: null, subject: "admin" }), () => now, otherApps, sso);
    const crossApp = await call("/api/admin/other-app/api-tokens", "GET", undefined, undefined, multi);
    expect((await data<{ items: unknown[] }>(crossApp)).items).toEqual([]);
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, issued.token + "bad")).status).toBe(401);
    expect((await call(`${tokenAdmin}/${issued.id}`, "DELETE")).status).toBe(200);
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, issued.token)).status).toBe(401);
  });

  it("schedules a new reservation and stores an idempotent execution result", async () => {
    const created = await data<{ id: string; nextAttemptAt: string; scheduleVersion: number }>(await call(base, "POST", input));
    const target = new Date(created.nextAttemptAt).getTime();
    expect(created.scheduleVersion).toBe(1);
    expect(target).toBeGreaterThanOrEqual(new Date(course.classBeginTime).getTime() - 8 * 60_000 - 5000);
    expect(target).toBeLessThanOrEqual(new Date(course.classBeginTime).getTime() - 8 * 60_000 + 5000);
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const attempt = await repository.beginAttempt(created.id, 1, now);
    const failed = { reservationId: created.id, attemptId: attempt!.activeAttemptId!,
      status: "FAILED" as const, code: 2003, message: "not open", data: {} };
    const firstFailure = await repository.completeAttempt(created.id, failed, now);
    expect(firstFailure?.nextAttemptAt).toBe(new Date(now.getTime() + 30_000).toISOString());
    expect((await repository.completeAttempt(created.id, failed, new Date(now.getTime() + 5000)))?.nextAttemptAt)
      .toBe(firstFailure?.nextAttemptAt);
    let retry = await repository.beginAttempt(created.id, 1, new Date(now.getTime() + 30_000));
    for (const [wait, elapsed] of [[60_000, 30_000], [120_000, 90_000]] as const) {
      const failedRetry = await repository.completeAttempt(created.id, { ...failed, attemptId: retry!.activeAttemptId! },
        new Date(now.getTime() + elapsed));
      expect(failedRetry?.nextAttemptAt).toBe(new Date(now.getTime() + elapsed + wait).toISOString());
      retry = await repository.beginAttempt(created.id, 1, new Date(now.getTime() + elapsed + wait));
    }
    const result = { reservationId: created.id, attemptId: retry!.activeAttemptId,
      status: "SUCCESS" as const, code: 0, message: "ok", data: { courseScheduleId: "12345" } };
    for (let count = 0; count < 2; count += 1) {
      expect(await repository.completeAttempt(created.id, { ...result, attemptId: result.attemptId! }, now))
        .toMatchObject({ status: "SUCCESS", resultCode: 0 });
    }
    expect((await call(`${detailBase}/${created.id}/result`, "POST", result)).status).toBe(404);
  });

  it("rejects a result from an older attempt after the next attempt starts", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const first = await repository.beginAttempt(created.id, created.scheduleVersion, now);
    await repository.completeAttempt(created.id, { reservationId: created.id, attemptId: first!.activeAttemptId!,
      status: "FAILED", code: 2003, message: "not open", data: {} }, now);
    const second = await repository.beginAttempt(created.id, created.scheduleVersion, new Date(now.getTime() + 30_000));
    const stale = await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: first!.activeAttemptId!, status: "SUCCESS", code: 0, message: "late", data: {} }, now);
    expect(stale).toMatchObject({ status: "IN_PROGRESS", activeAttemptId: second!.activeAttemptId });
    expect((await repository.events(created.id))?.filter((event) => event.kind === "RESULT_SUCCESS")).toHaveLength(0);
  });

  it("invalidates an in-progress attempt when its reservation is rescheduled", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const triggered = await repository.triggerNow(created.id, created.scheduleVersion, now);
    const oldAttempt = await repository.beginAttempt(created.id, triggered!.scheduleVersion, now);
    const changed = await data<{ scheduleVersion: number; status: string; activeAttemptId: string | null;
      attemptCount: number }>(await call(base, "POST", { ...input, course: { ...course,
        classBeginTime: new Date(classBegin.getTime() + 30 * 60_000).toISOString(),
        classEndTime: new Date(classEnd.getTime() + 30 * 60_000).toISOString(),
      } }));
    expect(changed).toMatchObject({ scheduleVersion: triggered!.scheduleVersion + 1,
      status: "QUEUED", activeAttemptId: null, attemptCount: 0 });
    const stale = await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: oldAttempt!.activeAttemptId!, status: "SUCCESS", code: 0, message: "late", data: {} }, now);
    expect(stale?.status).toBe("QUEUED");
    expect((await repository.events(created.id))?.filter((event) => event.kind === "RESULT_SUCCESS")).toHaveLength(0);
  });

  it("accepts a synchronous service result and maps transport uncertainty to a retryable failure", async () => {
    const result = { reservationId: "r_123", attemptId: "r_123:1:1", status: "SUCCESS",
      code: 0, message: "ok", data: { stuSignStatus: "1" } };
    const send = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ code: 0, success: true, message: "ok", data: result }));
    expect(await executeCheckin("https://iclass.example.com", "secret", result.reservationId,
      result.attemptId, send, () => 1_000)).toEqual(result);
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0];
    expect(String(request?.[0])).toBe("https://iclass.example.com/internal/checkin-executions");
    expect(request?.[1]?.method).toBe("POST");
    const timeout = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    expect(await executeCheckin("https://iclass.example.com", "secret", result.reservationId,
      result.attemptId, timeout)).toMatchObject({ status: "FAILED", code: 408 });
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    expect(await executeCheckin("https://iclass.example.com", "secret", result.reservationId,
      result.attemptId, busy)).toMatchObject({ status: "FAILED", code: 503 });
    const mismatched = vi.fn(async () => Response.json({ code: 0, success: true, data: {
      ...result, attemptId: "r_123:1:2",
    } }));
    expect(await executeCheckin("https://iclass.example.com", "secret", result.reservationId,
      result.attemptId, mismatched)).toMatchObject({ status: "FAILED", code: 502 });
  });

  it("lets an owner cancel, restore, and permanently delete a reservation", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const other = createApp(async () => ({ email: null, subject: null }), () => now,
      undefined, async () => ({ userId: "user-2", clientId: "android" }));
    expect((await call(`${base}/${created.id}/cancel`, "POST", undefined, undefined, other)).status).toBe(404);
    expect((await call(`${base}/${created.id}`, "DELETE", undefined, undefined, other)).status).toBe(404);
    const cancelled = await data<{ status: string; scheduleVersion: number }>(await call(`${base}/${created.id}/cancel`, "POST"));
    expect(cancelled).toMatchObject({ status: "CANCELLED", scheduleVersion: created.scheduleVersion + 1 });
    expect((await data<{ scheduleVersion: number }>(await call(`${base}/${created.id}/cancel`, "POST"))).scheduleVersion)
      .toBe(cancelled.scheduleVersion);
    expect((await call(base, "POST", input)).status).toBe(409);
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    expect((await repository.completeAttempt(created.id, { reservationId: created.id, attemptId: `${created.id}:1:1`,
      status: "SUCCESS", code: 0, message: "late", data: {} }, now))?.status).toBe("CANCELLED");
    const restored = await data<{ status: string; scheduleVersion: number; nextAttemptAt: string }>(
      await call(`${base}/${created.id}/restore`, "POST"));
    expect(restored).toMatchObject({ status: "QUEUED", scheduleVersion: cancelled.scheduleVersion + 1 });
    expect(Date.parse(restored.nextAttemptAt)).toBeGreaterThan(now.getTime());
    expect((await call(`${base}/${created.id}/restore`, "POST")).status).toBe(409);
    const active = await repository.beginAttempt(created.id, restored.scheduleVersion, now);
    expect(active?.status).toBe("IN_PROGRESS");
    expect((await call(`${base}/${created.id}/cancel`, "POST")).status).toBe(409);
    const waiting = await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: active!.activeAttemptId!, status: "FAILED", code: 2003, message: "not open", data: {} }, now);
    expect(waiting?.status).toBe("QUEUED");
    const cancelledRetry = await data<{ status: string; scheduleVersion: number }>(
      await call(`${base}/${created.id}/cancel`, "POST"));
    expect(cancelledRetry).toMatchObject({ status: "CANCELLED", scheduleVersion: restored.scheduleVersion + 1 });
    expect((await repository.beginAttempt(created.id, restored.scheduleVersion, now))).toBeNull();
    expect((await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: active!.activeAttemptId!, status: "SUCCESS", code: 0, message: "late", data: {} }, now))?.status)
      .toBe("CANCELLED");
    expect((await call(`${base}/${created.id}`, "DELETE")).status).toBe(200);
    expect((await repository.get(created.id))).toBeNull();
    expect((await call(`${base}/${created.id}`, "DELETE")).status).toBe(404);
  });

  it("lets administrators trigger an immediate workflow and enforces the course end cutoff", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", input));
    const triggered = await data<{ status: string; nextAttemptAt: string; scheduleVersion: number; workflowInstanceId: string }>(
      await call(`${reservationAdmin}/${created.id}/checkin`, "POST"));
    expect(triggered).toMatchObject({ status: "QUEUED", nextAttemptAt: now.toISOString(),
      scheduleVersion: created.scheduleVersion + 1 });
    expect(triggered.workflowInstanceId).toContain(String(triggered.scheduleVersion));
    const cancelled = await data<{ status: string }>(await call(`${reservationAdmin}/${created.id}/cancel`, "POST"));
    expect(cancelled.status).toBe("CANCELLED");
    const ended = createApp(async () => ({ email: "admin@example.com", subject: "admin-1" }),
      () => new Date(course.classEndTime), undefined, sso);
    expect((await call(`${reservationAdmin}/${created.id}/restore`, "POST", undefined, undefined, ended)).status).toBe(409);
    expect((await call(`${reservationAdmin}/${created.id}/checkin`, "POST", undefined, undefined, ended)).status).toBe(409);
    expect((await call(`${reservationAdmin}/${created.id}`, "DELETE")).status).toBe(200);
  });

  it("stops retrying at the course end time", async () => {
    const created = await data<{ id: string }>(await call(base, "POST", input));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const afterOldCutoff = new Date(Date.parse(course.classBeginTime) + 11 * 60_000);
    const first = await repository.beginAttempt(created.id, 1, afterOldCutoff);
    const retryable = await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: first!.activeAttemptId!, status: "FAILED", code: 2003, message: "not open", data: {} }, afterOldCutoff);
    expect(retryable?.status).toBe("QUEUED");
    const nearEnd = new Date(Date.parse(course.classEndTime) - 20_000);
    const attempt = await repository.beginAttempt(created.id, 1, nearEnd);
    const result = await repository.completeAttempt(created.id, { reservationId: created.id,
      attemptId: attempt!.activeAttemptId!, status: "FAILED", code: 2003, message: "not open", data: {} }, nearEnd);
    expect(result).toMatchObject({ status: "FAILED", nextAttemptAt: null });
    const other = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", {
      ...input, course: { ...course, id: 12346 },
    }));
    expect(await repository.beginAttempt(other.id, other.scheduleVersion, new Date(course.classEndTime))).toBeNull();
  });

  it("stops after six retries beyond the first check-in attempt", async () => {
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", {
      ...input, course: { ...course, classEndTime: new Date(classEnd.getTime() + 24 * 60 * 60_000).toISOString() },
    }));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    let attemptAt = now;
    for (let number = 1; number <= 7; number += 1) {
      const attempt = await repository.beginAttempt(created.id, created.scheduleVersion, attemptAt);
      expect(attempt).toMatchObject({ status: "IN_PROGRESS", attemptCount: number });
      const result = await repository.completeAttempt(created.id, {
        reservationId: created.id, attemptId: attempt!.activeAttemptId!,
        status: "FAILED", code: 2003, message: "not open", data: {},
      }, attemptAt);
      expect(result?.attemptCount).toBe(number);
      if (number <= 6) {
        expect(result?.status).toBe("QUEUED");
        expect(result?.nextAttemptAt).toBeTruthy();
        attemptAt = new Date(result!.nextAttemptAt!);
      } else {
        expect(result).toMatchObject({ status: "FAILED", nextAttemptAt: null,
          completedAt: attemptAt.toISOString() });
      }
    }
    expect(await repository.beginAttempt(created.id, created.scheduleVersion, attemptAt)).toBeNull();
  });

  it("recovers an in-progress attempt whose request timed out", async () => {
    const testNow = new Date();
    const currentApp = createApp(async () => ({ email: "admin@example.com", subject: "admin-1" }),
      () => testNow, undefined, sso);
    const classBeginTime = new Date(testNow.getTime() + 2 * 24 * 60 * 60_000);
    const created = await data<{ id: string; scheduleVersion: number }>(await call(base, "POST", {
      ...input, course: { ...course, classBeginTime: classBeginTime.toISOString(),
        classEndTime: new Date(classBeginTime.getTime() + 90 * 60_000).toISOString() },
    }, undefined, currentApp));
    const repository = new ReservationRepository(env.API_PLATFORM_DB);
    const attempt = await repository.beginAttempt(created.id, created.scheduleVersion,
      new Date(Date.now() - 76_000));
    expect(attempt?.status).toBe("IN_PROGRESS");

    await reconcileWorkflows(env);
    const recovered = await repository.get(created.id);
    expect(recovered).toMatchObject({ status: "QUEUED", attemptCount: 1, resultCode: 408,
      resultMessage: "等待签到结果超过 60 秒" });
    expect(recovered?.nextAttemptAt).toBeTruthy();
    await repository.timeoutAttempt(created.id, attempt!.activeAttemptId!, new Date());
    expect((await repository.events(created.id))?.filter((event) => event.kind === "RESULT_FAILED")).toHaveLength(1);
  });

  it("rotates only the secret while preserving token metadata and invalidating the old secret", async () => {
    const reservation = await data<{ id: string }>(await call(base, "POST", input));
    const original = await data<{ id: string; token: string; name: string; permissions: string[]; expiresAt: string; createdBy: string; createdAt: string }>(
      await call(tokenAdmin, "POST", {
        name: "iClass service", permissions: ["reservations:read"], expiresAt: tokenExpiry,
      }),
    );
    const response = await call(`${tokenAdmin}/${original.id}/rotate`, "POST");
    expect(response.status).toBe(200);
    const rotated = await data<typeof original>(response);
    expect(rotated.token).toMatch(/^apt_/);
    expect(rotated.token).not.toBe(original.token);
    expect({ ...rotated, token: original.token }).toEqual(original);
    const stored = await env.API_PLATFORM_DB.prepare("SELECT token_hash AS tokenHash FROM api_tokens WHERE id = ?")
      .bind(original.id).first<{ tokenHash: string }>();
    expect(stored?.tokenHash).toBe(await hashApiToken(rotated.token));
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, original.token)).status).toBe(401);
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, rotated.token)).status).toBe(200);
    const listed = await data<{ items: unknown[] }>(await call(tokenAdmin));
    expect(JSON.stringify(listed)).not.toContain(rotated.token);
    expect((await call(`${tokenAdmin}/${original.id}/rotate`, "GET")).status).toBe(405);
  });

  it("only deletes revoked tokens and rejects rotation of revoked, expired, or foreign tokens", async () => {
    const issued = await data<{ id: string; token: string }>(await call(tokenAdmin, "POST", {
      name: "delete me", permissions: ["reservations:read"],
    }));
    expect((await call(`${tokenAdmin}/${issued.id}/permanent`, "DELETE")).status).toBe(409);
    const otherApps = defineApps([{ id: "buaa-classhopper", name: "BUAA" }, { id: "other-app", name: "Other" }]);
    const multi = createApp(async () => ({ email: null, subject: "admin" }), () => now, otherApps, sso);
    const foreignPath = `/api/admin/other-app/api-tokens/${issued.id}`;
    expect((await call(`${foreignPath}/rotate`, "POST", undefined, undefined, multi)).status).toBe(404);
    expect((await call(`${foreignPath}/permanent`, "DELETE", undefined, undefined, multi)).status).toBe(404);
    expect((await call(`${tokenAdmin}/${issued.id}`, "DELETE")).status).toBe(200);
    expect((await call(`${tokenAdmin}/${issued.id}/rotate`, "POST")).status).toBe(409);
    expect((await call(`${tokenAdmin}/${issued.id}/permanent`, "DELETE")).status).toBe(200);
    expect((await call(`${tokenAdmin}/${issued.id}/permanent`, "DELETE")).status).toBe(404);
    expect((await call(`${tokenAdmin}/${issued.id}/rotate`, "POST")).status).toBe(404);
    expect((await data<{ items: unknown[] }>(await call(tokenAdmin))).items).toEqual([]);

    const expiring = await data<{ id: string }>(await call(tokenAdmin, "POST", {
      name: "expiring", permissions: ["reservations:read"], expiresAt: tokenExpiry,
    }));
    await env.API_PLATFORM_DB.prepare("UPDATE api_tokens SET expires_at = ? WHERE id = ?")
      .bind(now.toISOString(), expiring.id).run();
    expect((await call(`${tokenAdmin}/${expiring.id}/rotate`, "POST")).status).toBe(409);
    expect((await call(`${tokenAdmin}/${expiring.id}/permanent`, "DELETE")).status).toBe(409);
    expect((await call(`${tokenAdmin}/${expiring.id}`, "DELETE")).status).toBe(200);
    expect((await call(`${tokenAdmin}/${expiring.id}/permanent`, "DELETE")).status).toBe(200);
  });

  it("enforces token expiry and permission without leaking a token", async () => {
    const reservation = await data<{ id: string }>(await call(base, "POST", input));
    const expired = await data<{ token: string }>(await call(tokenAdmin, "POST", {
      name: "expiring", permissions: ["reservations:read"], expiresAt: tokenExpiry,
    }));
    await env.API_PLATFORM_DB.prepare("UPDATE api_tokens SET expires_at = ? WHERE name = ?")
      .bind("2000-01-01T00:00:00.000Z", "expiring").run();
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, expired.token)).status).toBe(401);
    const limited = await data<{ token: string }>(await call(tokenAdmin, "POST", {
      name: "limited", permissions: ["reservations:read"],
    }));
    await env.API_PLATFORM_DB.prepare("UPDATE api_tokens SET permissions_json = ? WHERE name = ?")
      .bind("[]", "limited").run();
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, limited.token)).status).toBe(403);
    const foreignToken = generateApiToken();
    await env.API_PLATFORM_DB.prepare(`INSERT INTO api_tokens
      (id, app_id, name, token_hash, permissions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), "other-app", "foreign",
      await hashApiToken(foreignToken), '["reservations:read"]', now.toISOString()).run();
    expect((await call(`${detailBase}/${reservation.id}`, "GET", undefined, foreignToken)).status).toBe(401);
  });
});

describe("SSO JWT verifier", () => {
  it("accepts a signed token with the app audience and rejects wrong claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { kid: "key-1", use: "sig", alg: "RS256" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ keys: [jwk] }));
    const sign = (audience: string, issuer = "https://sso.example.com", subject = "user-1", expiration = "5m") =>
      new SignJWT({ client_id: "android" }).setProtectedHeader({ alg: "RS256", kid: "key-1" })
        .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
    const verify = createSsoVerifier();
    const request = (token: string) => new Request("https://example.com/api/buaa-classhopper/reservations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const good = await sign("api-platform-buaa-classhopper");
    expect(await verify(request(good), "https://sso.example.com", "buaa-classhopper"))
      .toEqual({ userId: "user-1", clientId: "android" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const token of [
      await sign("other-app"), await sign("api-platform-buaa-classhopper", "https://other.example.com"),
      await sign("api-platform-buaa-classhopper", "https://sso.example.com", ""),
      await sign("api-platform-buaa-classhopper", "https://sso.example.com", "user-1", "0s"),
      good.slice(0, -2) + "xx",
    ]) {
      await expect(verify(request(token), "https://sso.example.com", "buaa-classhopper"))
        .rejects.toMatchObject({ status: 401 });
    }
    vi.restoreAllMocks();
  });
});
