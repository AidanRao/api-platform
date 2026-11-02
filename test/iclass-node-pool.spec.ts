import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IclassNodePool } from "../src/domains/buaa-classhopper/iclass/node-pool";
import { IclassClient } from "../src/domains/buaa-classhopper/iclass/client";
import { createCheckinClient } from "../src/domains/buaa-classhopper/reservations/checkin-client";
import { signCheckinBody } from "../src/infrastructure/hmac";

const config = { ENVIRONMENT: "production", ICLASS_SERVICE_BASE_URL: "http://localhost",
  ICLASS_SERVICE_SECRET: "shared-test-secret" } as const;
const success = (data: unknown = []) => Response.json({ code: 0, success: true, data });
const ready = (available = 4) => Response.json({ status: "ready", upstream: { iclass: "available" },
  checkin: { limit: 4, running: 4 - available, available, accepting: available > 0 } });
const busy = () => Response.json({ code: 1004, success: false, data: {} }, { status: 503 });
type Reply = (request: Request) => Response | Promise<Response>;
let logs: unknown[][] = [];

const stalled: Reply = (request) => new Promise<Response>((_resolve, reject) => {
  if (request.signal.aborted) reject(request.signal.reason);
  else request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
});

function fixture(names = ["NODE_A", "NODE_B"]) {
  const calls: { node: string; request: Request }[] = [];
  const probes: string[] = [];
  const replies: Record<string, Reply> = {};
  const readiness: Record<string, Reply> = {};
  const bindings = Object.fromEntries(names.map((node) => [node, { fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/readyz") {
      probes.push(node);
      return (readiness[node] ?? (() => ready()))(request);
    }
    calls.push({ node, request });
    return (replies[node] ?? (() => success()))(request);
  } }]));
  const env = { ...config, ...bindings, ICLASS_SERVICE_BINDINGS: names };
  const pool = new IclassNodePool(env);
  const request = (operation: "schedule" | "sign" | "checkin" = "schedule", signal?: AbortSignal) =>
    new Request(`http://localhost/internal/${operation}`, { method: operation === "schedule" ? "GET" : "POST",
      ...(operation === "schedule" ? {} : { body: "original-body" }), signal: signal ?? AbortSignal.timeout(25_000) });
  const send = (operation: "schedule" | "sign" | "checkin" = "schedule", account = "private-account") =>
    pool.fetch(request(operation), account, operation);
  const primary = async () => {
    await send();
    const first = calls[0]!.node;
    calls.length = 0;
    probes.length = 0;
    return { first, other: names.find((node) => node !== first)! };
  };
  return { env, pool, calls, probes, replies, readiness, request, send, primary };
}

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logs.push(args); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("iClass node configuration and affinity", () => {
  it.each([undefined, [], [""], ["NODE_A", "NODE_A"], "NODE_A", [123], ["missing"]])(
    "rejects invalid binding configuration %j before sending", (names) => {
      expect(() => new IclassNodePool({ ...config, ICLASS_SERVICE_BINDINGS: names })).toThrow();
    });
  it("rejects bindings without fetch and invalid base URLs", () => {
    const invalid = { ...config, ICLASS_SERVICE_BINDINGS: ["NODE_A"], NODE_A: { fetch: false } };
    expect(() => new IclassNodePool(invalid)).toThrow("NODE_A");
    const url = { ...invalid, ICLASS_SERVICE_BASE_URL: "ftp://localhost" };
    // Runtime config validation also covers values outside the generated literal types.
    expect(() => Reflect.construct(IclassNodePool, [url])).toThrow("URL");
  });
  it("retains the single-node and development HTTP transports", async () => {
    const f = fixture(["NODE_A"]);
    await f.send();
    expect(f.probes).toEqual(["NODE_A"]);
    expect(f.calls.map((call) => call.node)).toEqual(["NODE_A"]);
    const direct = vi.fn(async (_request: Request) => success());
    vi.stubGlobal("fetch", direct);
    const development = new IclassNodePool({ ...config, ENVIRONMENT: "development" });
    await development.fetch(f.request(), "account", "schedule");
    expect(direct).toHaveBeenCalledTimes(1);
    expect(new URL(direct.mock.calls[0]![0].url).pathname).toBe("/internal/schedule");
  });
  it("uses VPC exclusively and keeps account affinity across order changes and operations", async () => {
    const f = fixture();
    const { first } = await f.primary();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("public transport forbidden"); }));
    await f.send("schedule"); await f.send("sign"); await f.send("checkin");
    const reversed = new IclassNodePool({ ...f.env, ICLASS_SERVICE_BINDINGS: ["NODE_B", "NODE_A"] });
    await reversed.fetch(f.request(), "private-account", "schedule");
    expect(f.calls.map((call) => call.node)).toEqual([first, first, first, first]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("moves accounts only to an added node or away from a removed node", async () => {
    const f = fixture(["NODE_A", "NODE_B", "NODE_C"]);
    const two = new IclassNodePool({ ...f.env, ICLASS_SERVICE_BINDINGS: ["NODE_A", "NODE_B"] });
    const remaining = new IclassNodePool({ ...f.env, ICLASS_SERVICE_BINDINGS: ["NODE_A", "NODE_C"] });
    const selected = async (pool: IclassNodePool, account: string) => {
      await pool.fetch(f.request(), account, "schedule");
      return f.calls.pop()!.node;
    };
    const initial = new Set<string>();
    for (let index = 0; index < 24; index++) {
      const account = `account-${index}`;
      const before = await selected(two, account);
      const added = await selected(f.pool, account);
      initial.add(before);
      if (added !== before) expect(added).toBe("NODE_C");
      const removed = await selected(remaining, account);
      if (added !== "NODE_B") expect(removed).toBe(added);
      expect(removed).not.toBe("NODE_B");
    }
    expect(initial.size).toBe(2);
  });
});

describe("readiness and safe failover", () => {
  it("probes in parallel and does not cache readiness between calls", async () => {
    const f = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    for (const node of ["NODE_A", "NODE_B"]) f.readiness[node] = async () => { await waiting; return ready(); };
    const pending = f.send();
    while (f.probes.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(0);
    release(); await pending;
    await f.send();
    expect(f.probes).toHaveLength(4);
  });
  it.each(["unreachable", "upstream_unavailable", "malformed", "invalid_capacity"])(
    "skips a preferred node whose probe is %s", async (reason) => {
      const f = fixture(); const { first, other } = await f.primary();
      f.readiness[first] = () => {
        if (reason === "unreachable") throw new Error("offline");
        if (reason === "upstream_unavailable") return new Response("offline", { status: 503 });
        if (reason === "invalid_capacity") return ready(5);
        return Response.json({ status: "ready" });
      };
      await f.send("sign");
      expect(f.calls.map((call) => call.node)).toEqual([other]);
    });
  it("ignores reservation capacity for queries and direct signing, but routes reservations elsewhere", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    f.readiness[first] = () => ready(0);
    await f.send(); await f.send("sign"); await f.send("checkin");
    expect(f.calls.map((call) => call.node)).toEqual([first, first, other]);
  });
  it("returns unavailable or busy without sending a business POST", async () => {
    const f = fixture();
    for (const node of ["NODE_A", "NODE_B"]) f.readiness[node] = () => new Response("offline", { status: 503 });
    expect(await (await f.send("sign")).json()).toMatchObject({ code: 2001, success: false });
    for (const node of ["NODE_A", "NODE_B"]) f.readiness[node] = () => ready(0);
    expect(await (await f.send("checkin")).json()).toMatchObject({ code: 1004, success: false });
    expect(f.calls).toHaveLength(0);
  });
  it.each(["network", "http_503", "vpn", "upstream"])("fails over a query after %s", async (reason) => {
    const f = fixture(); const { first, other } = await f.primary();
    f.replies[first] = () => {
      if (reason === "network") throw new Error("offline");
      if (reason === "http_503") return new Response("proxy failed", { status: 503 });
      return Response.json({ code: reason === "vpn" ? 2001 : 2005, success: false });
    };
    expect((await f.send()).ok).toBe(true);
    expect(f.calls.map((call) => call.node)).toEqual([first, other]);
  });
  it("does not switch nodes for authorization or parameter errors, including HTTP 5xx", async () => {
    const f = fixture(); const { first } = await f.primary();
    for (const code of [1001, 1002, 2002]) {
      f.calls.length = 0;
      f.replies[first] = () => Response.json({ code, success: false }, { status: 503 });
      expect(await (await f.send()).json()).toMatchObject({ code });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("only retries a POST after an explicit busy envelope, at most once per node", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    f.replies[first] = busy;
    await f.send("sign");
    expect(f.calls.map((call) => call.node)).toEqual([first, other]);
    expect(await f.calls[0]!.request.text()).toBe("original-body");
    expect(await f.calls[1]!.request.text()).toBe("original-body");
    f.calls.length = 0; f.replies[other] = busy;
    expect((await f.send("checkin")).status).toBe(503);
    expect(f.calls.map((call) => call.node)).toEqual([first, other]);
  });
  it.each(["timeout", "network", "raw_503", "unknown", "invalid_json", "string_code", "success_true"])(
    "does not replay a POST after %s", async (reason) => {
      const f = fixture(); const { first } = await f.primary();
      f.replies[first] = () => {
        if (reason === "timeout") throw new DOMException("timed out", "TimeoutError");
        if (reason === "network") throw new Error("reset");
        if (reason === "raw_503") return new Response("proxy failed", { status: 503 });
        if (reason === "invalid_json") return new Response("invalid JSON");
        return Response.json({ code: reason === "string_code" ? "1004" : reason === "unknown" ? 2004 : 1004,
          success: reason === "success_true" }, { status: 503 });
      };
      await f.send("sign").catch(() => undefined);
      expect(f.calls.map((call) => call.node)).toEqual([first]);
    });
  it("enforces the shared deadline during probes and response bodies", async () => {
    const f = fixture();
    const probeController = new AbortController();
    f.readiness.NODE_A = (request) => {
      probeController.abort(new DOMException("timeout", "TimeoutError"));
      return stalled(request);
    };
    await expect(f.pool.fetch(f.request("schedule", probeController.signal), "account", "schedule"))
      .rejects.toMatchObject({ name: "TimeoutError" });
    expect(f.calls).toHaveLength(0);
    delete f.readiness.NODE_A;
    const { first } = await f.primary();
    const bodyController = new AbortController();
    f.replies[first] = () => new Response(new ReadableStream({ start() {
      setTimeout(() => bodyController.abort(new DOMException("timeout", "TimeoutError")), 0);
    } }));
    await expect(f.pool.fetch(f.request("sign", bodyController.signal), "private-account", "sign"))
      .rejects.toMatchObject({ name: "TimeoutError" });
    expect(f.calls).toHaveLength(1);
  });
  it("limits probe waits to three seconds and continues with a healthy node", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    f.readiness[first] = stalled;
    await f.send("checkin");
    expect(f.calls.map((call) => call.node)).toEqual([other]);
  });
  it("rejects oversized probe bodies and does not replay an oversized POST response", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    f.readiness[first] = () => new Response("x".repeat(16 * 1024 + 1));
    await f.send("sign");
    expect(f.calls.map((call) => call.node)).toEqual([other]);
    delete f.readiness[first]; f.calls.length = 0;
    f.replies[first] = () => new Response("x".repeat(4 * 1024 * 1024 + 1));
    await expect(f.send("sign")).rejects.toThrow("size limit");
    expect(f.calls.map((call) => call.node)).toEqual([first]);
  });
  it("does not reset the query deadline when switching nodes", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    const controller = new AbortController();
    f.replies[first] = () => new Response("upstream failed", { status: 503 });
    f.replies[other] = (request) => {
      controller.abort(new DOMException("budget exhausted", "TimeoutError"));
      return stalled(request);
    };
    await expect(f.pool.fetch(f.request("schedule", controller.signal), "private-account", "schedule"))
      .rejects.toMatchObject({ name: "TimeoutError" });
    expect(f.calls.map((call) => call.node)).toEqual([first, other]);
  });
});

describe("business client integration", () => {
  it("maps production configuration errors to service unavailable before calling a node", async () => {
    const f = fixture();
    const client = new IclassClient({ ...f.env, ICLASS_SERVICE_BINDINGS: [] }, () => new Date());
    await expect(client.schedule("account", "2026-11-02"))
      .rejects.toMatchObject({ status: 503, data: { reason: "ICLASS_UNAVAILABLE" } });
    await expect(client.sign("account", "course-1"))
      .rejects.toMatchObject({ status: 503, data: { reason: "ICLASS_UNAVAILABLE" } });
    expect(f.probes).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });
  it("keeps reservation bodies, signatures and attempt IDs unchanged when switching nodes", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    const result = { reservationId: "reservation-1", attemptId: "reservation-1:1:1", status: "SUCCESS",
      code: 0, message: "ok", data: {} };
    f.replies[first] = busy;
    f.replies[other] = () => success(result);
    const checkin = createCheckinClient(f.env);
    expect(await checkin(result.reservationId, result.attemptId, "private-account")).toEqual(result);
    expect(f.calls.map((call) => call.node)).toEqual([first, other]);
    for (const { request } of f.calls) {
      expect(new URL(request.url).pathname).toBe("/internal/checkin-executions");
      const body = await request.text();
      expect(JSON.parse(body)).toEqual({ reservationId: result.reservationId, attemptId: result.attemptId });
      expect(request.headers.get("X-Service-ID")).toBe("iclass-service");
      expect(request.headers.get("X-Signature")).toBe(await signCheckinBody(
        config.ICLASS_SERVICE_SECRET, request.headers.get("X-Timestamp")!, body));
    }
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).toContain("retry_next_node");
    expect(serializedLogs).not.toContain("private-account");
    expect(serializedLogs).not.toContain(config.ICLASS_SERVICE_SECRET);
  });
  it("maps an uncertain reservation result to the existing workflow failure without replaying", async () => {
    const f = fixture(); const { first } = await f.primary();
    f.replies[first] = () => { throw new DOMException("timeout", "TimeoutError"); };
    expect(await createCheckinClient(f.env)("r_1", "r_1:1:1", "private-account"))
      .toMatchObject({ reservationId: "r_1", attemptId: "r_1:1:1", status: "FAILED", code: 408 });
    expect(f.calls).toHaveLength(1);
  });
  it("preserves query signing, authorization and direct-sign unknown-result errors", async () => {
    const f = fixture(); const { first, other } = await f.primary();
    const now = new Date("2026-11-02T00:00:00Z");
    const client = new IclassClient(f.env, () => now);
    f.replies[first] = () => new Response("upstream failed", { status: 503 });
    f.replies[other] = () => success([]);
    expect(await client.schedule("private-account", "2026-11-02")).toEqual([]);
    for (const { request } of f.calls) {
      expect(new URL(request.url).searchParams.get("loginName")).toBe("private-account");
      expect(request.headers.get("X-Signature")).toBe(await signCheckinBody(
        config.ICLASS_SERVICE_SECRET, String(now.getTime()), ""));
    }
    f.calls.length = 0;
    f.replies[first] = () => Response.json({ code: 2002, success: false, data: {} }, { status: 403 });
    await expect(client.schedule("private-account", "2026-11-02"))
      .rejects.toMatchObject({ data: { reason: "ICLASS_AUTHORIZATION_INVALID" } });
    expect(f.calls).toHaveLength(1);
    f.calls.length = 0;
    f.replies[first] = () => { throw new Error("reset"); };
    await expect(client.sign("private-account", "course-1"))
      .rejects.toMatchObject({ data: { reason: "SIGN_RESULT_UNKNOWN" } });
    expect(f.calls).toHaveLength(1);
  });
});
