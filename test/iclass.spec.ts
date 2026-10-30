import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import migration from "../migrations/0004_reservations_and_api_tokens.sql?raw";
import { createApp } from "../src/app";
import { ApiError } from "../src/http/errors";
import { IclassAuthorizationRepository } from "../src/domains/buaa-classhopper/iclass/repository";
import { ReservationRepository } from "../src/domains/buaa-classhopper/reservations/repository";
import { signCheckinBody } from "../src/infrastructure/hmac";

const base = "/api/buaa-classhopper/v1/iclass";
const clock = new Date("2026-10-27T01:40:00Z"); // 09:40, inclusive start of 09:50 class window.
const bindings = {
  ...env,
  ICLASS_SERVICE_BASE_URL: "https://iclass.internal",
  ICLASS_SERVICE_SECRET: "test-hmac",
};
const course = {
  courseScheduleId: "original-1",
  courseId: "100",
  courseName: "矩阵理论与应用",
  courseType: "",
  weekDay: "2",
  courseNum: "MATH",
  teacherName: ["王老师", "李老师"],
  classroomName: ["(三)311"],
  signStatus: 0,
  classBeginTime: "2026-10-27 09:50:00",
  classEndTime: "2026-10-27 10:35:00",
};
const verify = async (request: Request) => {
  if (!request.headers.has("Authorization"))
    throw new ApiError("缺少 Bearer 凭证", 401);
  return {
    userId: request.headers.get("X-Test-User") ?? "user-1",
    clientId: "classhopper",
  };
};
const app = createApp(undefined, () => clock, undefined, verify);
const reply = (data: unknown, code = 0, status = 200) =>
  Response.json({ code, success: code === 0, data }, { status });
function call(
  path: string,
  method = "GET",
  body?: unknown,
  user = "user-1",
  target = app,
) {
  return target.request(
    `https://example.com${base}${path}`,
    {
      method,
      headers: {
        Authorization: "Bearer test",
        "X-Test-User": user,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings,
  );
}
const json = async (response: Response) =>
  response.json() as Promise<{
    data: {
      authorized?: boolean;
      reason?: string;
      items?: unknown[];
      alreadySigned?: boolean;
    };
    code: number;
  }>;
const authorize = () =>
  call("/authorization", "PUT", { loginName: "sensitive-loginName" });
beforeAll(async () => {
  await env.API_PLATFORM_DB.batch(migration.split(";").filter((sql) => sql.trim())
    .map((sql) => env.API_PLATFORM_DB.prepare(sql)));
});
beforeEach(async () => {
  await env.API_PLATFORM_DB.prepare("DELETE FROM buaa_classhopper_reservations").run();
  const repo = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
  await Promise.all([repo.remove("user-1"), repo.remove("user-2")]);
  await Promise.all(
    ["user-1", "user-2"].map((id) =>
      env.API_PLATFORM_KV.delete(`buaa-classhopper:iclass:signin-lease:${id}`),
    ),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply([course])),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function reservation(status: string, userId = "user-1", loginName = "sensitive-loginName", scheduleId = course.courseScheduleId) {
  await env.API_PLATFORM_DB.prepare(`INSERT INTO buaa_classhopper_reservations
    (id, user_id, login_name, student_id, course_schedule_id, course_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), userId, loginName, "student-1", scheduleId,
      JSON.stringify({ courseId: course.courseId, courseName: course.courseName,
        courseNum: course.courseNum, classroomName: course.classroomName.join("、"),
        classBeginTime: "2026-10-27T01:50:00Z", classEndTime: "2026-10-27T02:35:00Z" }),
      status, clock.toISOString(), clock.toISOString()).run();
}

describe("schedule reservation flags", () => {
  it.each([
    ["QUEUED", true], ["IN_PROGRESS", true], ["CANCELLED", false],
    ["FAILED", false], ["SUCCESS", false],
  ])("marks %s reservations as isReserved=%s", async (status, isReserved) => {
    await authorize();
    await reservation(String(status));
    const response = await call("/course-schedules?date=2026-10-27");
    expect(response.status).toBe(200);
    expect((await json(response)).data.items).toEqual([{ ...course, isReserved }]);
  });

  it("returns explicit false without a reservation and preserves an empty schedule", async () => {
    await authorize();
    expect((await json(await call("/course-schedules?date=2026-10-27"))).data.items)
      .toEqual([{ ...course, isReserved: false }]);
    vi.mocked(fetch).mockResolvedValueOnce(reply([]));
    expect((await json(await call("/course-schedules?date=2026-10-27"))).data.items).toEqual([]);
  });

  it("matches user, authorized account and original schedule ID without merging rows", async () => {
    await authorize();
    await reservation("QUEUED", "user-2");
    await reservation("IN_PROGRESS", "user-1", "another-account");
    await reservation("QUEUED", "user-1", "sensitive-loginName", "original-2");
    vi.mocked(fetch).mockResolvedValueOnce(reply([course, { ...course, courseScheduleId: "original-2" }]));
    const lookup = vi.spyOn(ReservationRepository.prototype, "activeCourseScheduleIds");
    expect((await json(await call("/course-schedules?date=2026-10-27"))).data.items).toEqual([
      { ...course, isReserved: false },
      { ...course, courseScheduleId: "original-2", isReserved: true },
    ]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("user-1", "sensitive-loginName");
    await call("/authorization", "PUT", { loginName: "sensitive-loginName" }, "user-2");
    expect((await json(await call("/course-schedules?date=2026-10-27", "GET", undefined, "user-2"))).data.items)
      .toEqual([{ ...course, isReserved: true }]);
    await call("/authorization", "PUT", { loginName: "another-account" });
    expect((await json(await call("/course-schedules?date=2026-10-27"))).data.items)
      .toEqual([{ ...course, isReserved: true }]);
  });

  it("preserves signed status alongside an active reservation", async () => {
    await authorize();
    await reservation("QUEUED");
    vi.mocked(fetch).mockResolvedValueOnce(reply([{ ...course, signStatus: 1 }]));
    expect((await json(await call("/course-schedules?date=2026-10-27"))).data.items)
      .toEqual([{ ...course, signStatus: 1, isReserved: true }]);
  });

  it("rejects an authorization change during the reservation lookup", async () => {
    await authorize();
    vi.spyOn(ReservationRepository.prototype, "activeCourseScheduleIds").mockImplementationOnce(async () => {
      await new IclassAuthorizationRepository(env.API_PLATFORM_KV).remove("user-1");
      return new Set<string>();
    });
    const response = await call("/course-schedules?date=2026-10-27");
    expect(response.status).toBe(403);
    expect((await json(response)).data.reason).toBe("ICLASS_AUTHORIZATION_CHANGED");
  });

  it("fails the request instead of reporting unreserved when the database lookup fails", async () => {
    await authorize();
    vi.spyOn(ReservationRepository.prototype, "activeCourseScheduleIds")
      .mockRejectedValueOnce(new Error("database unavailable"));
    const response = await call("/course-schedules?date=2026-10-27");
    expect(response.status).toBe(500);
    expect((await json(response)).code).toBe(0);
  });
});

describe("iClass user authorization, schedules and immediate sign-in", () => {
  it("requires SSO and never exposes credentials", async () => {
    const response = await app.request(
      `https://example.com${base}/authorization`,
      {},
      bindings,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await json(await call("/authorization"))).data).toEqual({
      authorized: false,
      authorizedAt: null,
    });
    expect((await call("/course-schedules?date=2026-10-27")).status).toBe(403);
    expect(
      (
        await call("/authorization", "PUT", {
          loginName: "x",
          userId: "someone-else",
        })
      ).status,
    ).toBe(400);
    expect((await authorize()).status).toBe(200);
    const row = await new IclassAuthorizationRepository(
      env.API_PLATFORM_KV,
    ).get("user-1");
    expect(row).toEqual({
      login_name: "sensitive-loginName",
      authorized_at: clock.toISOString(),
    });
    expect(
      await env.API_PLATFORM_KV.get(
        "buaa-classhopper:iclass:authorization:user-1",
        "json",
      ),
    ).toEqual(row);
    const body = await (await call("/authorization")).text();
    expect(body).not.toContain("loginName");
    expect(body).not.toContain(row!.login_name);
    expect(
      (await json(await call("/authorization", "GET", undefined, "user-2")))
        .data.authorized,
    ).toBe(false);
  });
  it("reports KV failures without treating the user as unauthorized", async () => {
    for (const value of [
      "corrupt-json",
      JSON.stringify({ login_name: 123, authorized_at: clock.toISOString() }),
      JSON.stringify({ login_name: "", authorized_at: clock.toISOString() }),
      JSON.stringify({ login_name: "test", authorized_at: "invalid-date" }),
    ]) {
      await env.API_PLATFORM_KV.put(
        "buaa-classhopper:iclass:authorization:user-1",
        value,
      );
      expect((await call("/authorization")).status).toBe(503);
    }
    await new IclassAuthorizationRepository(env.API_PLATFORM_KV).remove(
      "user-1",
    );
    const repository = new IclassAuthorizationRepository({
      ...env.API_PLATFORM_KV,
      get: async () => {
        throw new Error("offline");
      },
    } as KVNamespace);
    await expect(repository.get("user-1")).rejects.toMatchObject({
      status: 503,
    });
  });
  it("accepts an empty day and preserves prior authorization on upstream errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply([]));
    expect((await authorize()).status).toBe(200);
    const repo = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
    const original = await repo.get("user-1");
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 2002, 502));
    const denied = await call("/authorization", "PUT", { loginName: "bad" });
    expect(denied.status).toBe(403);
    expect((await json(denied)).data.reason).toBe(
      "ICLASS_AUTHORIZATION_INVALID",
    );
    expect(await repo.get("user-1")).toEqual(original);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network"));
    expect(
      (await call("/authorization", "PUT", { loginName: "new" })).status,
    ).toBe(502);
    expect(await repo.get("user-1")).toEqual(original);
  });
  it("replaces the validated loginName while keeping each user's KV record separate", async () => {
    await authorize();
    expect(
      (await call("/authorization", "PUT", { loginName: "replacement-login" }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          "/authorization",
          "PUT",
          { loginName: "another-login" },
          "user-2",
        )
      ).status,
    ).toBe(200);
    const repo = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
    expect((await repo.get("user-1"))?.login_name).toBe("replacement-login");
    expect((await repo.get("user-2"))?.login_name).toBe("another-login");
    for (const [user, expected] of [
      ["user-1", "replacement-login"],
      ["user-2", "another-login"],
    ] as const) {
      vi.mocked(fetch).mockImplementationOnce(async (input) => {
        expect(
          new URL(new Request(input).url).searchParams.get("loginName"),
        ).toBe(expected);
        return reply([course]);
      });
      expect(
        (
          await call(
            "/course-schedules?date=2026-10-27",
            "GET",
            undefined,
            user,
          )
        ).status,
      ).toBe(200);
    }
    await call("/authorization", "DELETE");
    expect(await repo.get("user-1")).toBeNull();
    expect((await repo.get("user-2"))?.login_name).toBe("another-login");
  });
  it("returns upstream rows without merging and signs exact request bodies", async () => {
    await authorize();
    vi.mocked(fetch).mockImplementationOnce(async (input) => {
      const request = new Request(input);
      expect(new URL(request.url).searchParams.get("loginName")).toBe(
        "sensitive-loginName",
      );
      expect(request.headers.get("X-Signature")).toBe(
        await signCheckinBody(
          bindings.ICLASS_SERVICE_SECRET,
          String(clock.getTime()),
          "",
        ),
      );
      return reply([course, { ...course, courseScheduleId: "original-2" }]);
    });
    const response = await call("/course-schedules?date=2026-10-27");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await json(response)).data.items).toHaveLength(2);
    expect((await call("/course-schedules?date=2026-02-30")).status).toBe(400);
    expect(
      (
        await call(
          "/course-schedules?date=2026-10-27",
          "GET",
          undefined,
          "user-2",
        )
      ).status,
    ).toBe(403);
    await call("/authorization", "DELETE");
    expect((await call("/course-schedules?date=2026-10-27")).status).toBe(403);
  });
  it("checks ownership and accepts the inclusive time boundaries", async () => {
    await authorize();
    expect(
      (
        await call("/sign-ins", "POST", {
          date: "2026-10-27",
          courseScheduleId: "other",
        })
      ).status,
    ).toBe(404);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const request = new Request(input);
      if (request.method === "GET") return reply([course]);
      const body = await request.text();
      expect(JSON.parse(body)).toEqual({
        loginName: "sensitive-loginName",
        courseScheduleId: "original-1",
      });
      expect(request.headers.get("X-Signature")).toBe(
        await signCheckinBody(
          bindings.ICLASS_SERVICE_SECRET,
          request.headers.get("X-Timestamp")!,
          body,
        ),
      );
      return reply({ courseScheduleId: "original-1", stuSignStatus: "1" });
    });
    expect(
      (
        await call("/sign-ins", "POST", {
          date: "2026-10-27",
          courseScheduleId: "original-1",
        })
      ).status,
    ).toBe(200);
    const endApp = createApp(
      undefined,
      () => new Date("2026-10-27T02:35:00Z"),
      undefined,
      verify,
    );
    expect(
      (
        await call(
          "/sign-ins",
          "POST",
          { date: "2026-10-27", courseScheduleId: "original-1" },
          "user-1",
          endApp,
        )
      ).status,
    ).toBe(200);
  });
  it("requires explicit outside-window confirmation and prevents repeated/in-progress work", async () => {
    await authorize();
    const outside = createApp(
      undefined,
      () => new Date("2026-10-27T03:00:00Z"),
      undefined,
      verify,
    );
    const input = { date: "2026-10-27", courseScheduleId: "original-1" };
    const response = await call("/sign-ins", "POST", input, "user-1", outside);
    expect(response.status).toBe(409);
    expect((await json(response)).data.reason).toBe(
      "SIGN_WINDOW_CONFIRMATION_REQUIRED",
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply([course]))
      .mockResolvedValueOnce(
        reply({ courseScheduleId: "original-1", stuSignStatus: "1" }),
      );
    expect(
      (
        await call(
          "/sign-ins",
          "POST",
          { ...input, allowOutsideWindow: true },
          "user-1",
          outside,
        )
      ).status,
    ).toBe(200);
    vi.mocked(fetch).mockResolvedValueOnce(
      reply([{ ...course, signStatus: 1 }]),
    );
    expect(
      (await json(await call("/sign-ins", "POST", input))).data.alreadySigned,
    ).toBe(true);
    const repo = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
    await repo.acquire("user-1", clock);
    expect(
      (await json(await call("/sign-ins", "POST", input))).data.reason,
    ).toBe("SIGN_IN_PROGRESS");
  });
  it.each(["revoked", "replaced", "renewed"])(
    "does not sign when authorization is %s while querying",
    async (change) => {
      await authorize();
      const count = vi.mocked(fetch).mock.calls.length;
      vi.mocked(fetch).mockImplementationOnce(async () => {
        const repo = new IclassAuthorizationRepository(env.API_PLATFORM_KV);
        if (change === "revoked") await repo.remove("user-1");
        else
          await repo.put(
            "user-1",
            change === "replaced" ? "new-login" : "sensitive-loginName",
            new Date(clock.getTime() + 1),
          );
        return reply([course]);
      });
      const response = await call("/sign-ins", "POST", {
        date: "2026-10-27",
        courseScheduleId: "original-1",
      });
      expect(response.status).toBe(403);
      expect((await json(response)).data.reason).toBe(
        "ICLASS_AUTHORIZATION_CHANGED",
      );
      expect(vi.mocked(fetch).mock.calls.length).toBe(count + 1);
    },
  );
  it("classifies malformed upstream responses without exposing raw errors", async () => {
    await authorize();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(null));
    const response = await call("/course-schedules?date=2026-10-27");
    expect(response.status).toBe(502);
    expect((await json(response)).data.reason).toBe("ICLASS_INVALID_RESPONSE");
    expect((await json(await call("/authorization"))).data.authorized).toBe(
      true,
    );
  });
  it("keeps authorization and never retries an uncertain sign-in", async () => {
    await authorize();
    const count = vi.mocked(fetch).mock.calls.length;
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply([course]))
      .mockRejectedValueOnce(new TypeError("timeout"));
    const response = await call("/sign-ins", "POST", {
      date: "2026-10-27",
      courseScheduleId: "original-1",
    });
    expect((await json(response)).data.reason).toBe("SIGN_RESULT_UNKNOWN");
    expect(vi.mocked(fetch).mock.calls.length).toBe(count + 2);
    expect((await json(await call("/authorization"))).data.authorized).toBe(
      true,
    );
  });
});

describe("KV sign-in leases", () => {
  const key = "buaa-classhopper:iclass:signin-lease:user-1";
  const repo = () => new IclassAuthorizationRepository(env.API_PLATFORM_KV);
  it("suppresses observed active leases, isolates users, and replaces expired leases", async () => {
    const first = await repo().acquire("user-1", clock);
    expect(first).toBeTruthy();
    expect(await repo().acquire("user-1", clock)).toBeNull();
    expect(await repo().acquire("user-2", clock)).toBeTruthy();
    const renewed = await repo().acquire(
      "user-1",
      new Date(clock.getTime() + 90_000),
    );
    expect(renewed).toBeTruthy();
    expect(renewed).not.toBe(first);
    const stored = await env.API_PLATFORM_KV.get<{
      leaseId: string;
      expiresAt: number;
    }>(key, "json");
    expect(stored).toEqual({
      leaseId: renewed,
      expiresAt: clock.getTime() + 180_000,
    });
  });
  it("only deletes the observed matching lease and permits reuse after release", async () => {
    const id = (await repo().acquire("user-1", clock))!;
    await repo().release("user-1", "unrelated-request");
    expect(await repo().acquire("user-1", clock)).toBeNull();
    await repo().release("user-1", id);
    expect(await env.API_PLATFORM_KV.get(key)).toBeNull();
    expect(await repo().acquire("user-1", clock)).toBeTruthy();
  });
  it("sets a 90-second KV TTL", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const repository = new IclassAuthorizationRepository({
      get: vi.fn().mockResolvedValue(null),
      put,
    } as unknown as KVNamespace);
    const id = await repository.acquire("user-1", clock);
    expect(put).toHaveBeenCalledWith(
      key,
      JSON.stringify({ leaseId: id, expiresAt: clock.getTime() + 90_000 }),
      { expirationTtl: 90 },
    );
  });
  it("fails before signing when KV is unavailable or its lease is corrupt", async () => {
    await env.API_PLATFORM_KV.put(key, "not-json");
    const response = await call("/sign-ins", "POST", {
      date: "2026-10-27",
      courseScheduleId: "original-1",
    });
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    const repository = new IclassAuthorizationRepository({
      get: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as KVNamespace);
    await expect(repository.acquire("user-1", clock)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("keeps the 90-second TTL as fallback when cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repository = new IclassAuthorizationRepository({
      get: vi.fn().mockResolvedValue({
        leaseId: "request-1",
        expiresAt: clock.getTime() + 90_000,
      }),
      delete: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as KVNamespace);
    await expect(
      repository.release("user-1", "request-1"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({ message: "iclass sign-in lease cleanup failed" }),
    );
    warn.mockRestore();
  });
});
