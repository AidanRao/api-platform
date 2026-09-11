import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { AccessPolicy } from "../src/domains/buaa-classhopper/access-policy.schema";
import { ACCESS_POLICY_KEY } from "../src/domains/buaa-classhopper/access-policy.repository";
import {
  ADMIN_ACCESS_POLICY_PATH,
  PUBLIC_ACCESS_POLICY_PATH,
} from "../src/domains/buaa-classhopper/routes";

const fixedNow = new Date("2026-09-10T04:00:00.000Z");
const policy: AccessPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001", "ZY370002"],
  names: ["张三", "李四"],
};

const authenticated = async () => ({
  email: "admin@example.com",
  subject: "admin-subject",
});

describe("API routes", () => {
  beforeEach(async () => {
    await env.API_PLATFORM_KV.delete(ACCESS_POLICY_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the public policy without authentication", async () => {
    await seedPolicy();

    const response = await request(PUBLIC_ACCESS_POLICY_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    await expect(response.json()).resolves.toEqual({
      code: 1,
      msg: "获取成功",
      data: policy,
    });
  });

  it("returns 503 when the public policy is missing", async () => {
    const response = await request(PUBLIC_ACCESS_POLICY_PATH);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: "白名单尚未配置",
      data: null,
    });
  });

  it("maps invalid stored data to a structured 500 response", async () => {
    await env.API_PLATFORM_KV.put(
      ACCESS_POLICY_KEY,
      JSON.stringify({ ...policy, revision: "invalid" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(PUBLIC_ACCESS_POLICY_PATH);

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: "服务器内部错误",
      data: null,
    });
  });

  it("patches the policy and generates the next revision", async () => {
    await seedPolicy();

    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: policy.revision,
        add: { studentIds: ["23370003"], names: ["王五"] },
        remove: { studentIds: ["23370001"], names: ["张三"] },
      }),
      true,
    );

    const expected = {
      schemaVersion: 1,
      revision: "2026-09-10-002",
      studentIds: ["ZY370002", "23370003"],
      names: ["李四", "王五"],
    };
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: 1,
      msg: "更新成功",
      data: expected,
    });
    await expect(
      env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json"),
    ).resolves.toEqual(expected);
  });

  it("does not write or advance revision for a no-op patch", async () => {
    await seedPolicy();
    const put = vi.spyOn(env.API_PLATFORM_KV, "put");

    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: policy.revision,
        add: { studentIds: ["23370001"] },
        remove: { names: ["不存在"] },
      }),
      true,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: 1,
      msg: "未发生变更",
      data: policy,
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 409 with the current revision for a stale patch", async () => {
    await seedPolicy();

    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: "2026-09-09-999",
        add: { names: ["王五"] },
      }),
      true,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: "白名单版本已更新，请刷新后重试",
      data: { currentRevision: policy.revision },
    });
    await expect(
      env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json"),
    ).resolves.toEqual(policy);
  });

  it("maps a future stored revision to 500 without changing KV", async () => {
    const futurePolicy = { ...policy, revision: "2026-09-11-001" };
    await env.API_PLATFORM_KV.put(
      ACCESS_POLICY_KEY,
      JSON.stringify(futurePolicy),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: futurePolicy.revision,
        add: { names: ["王五"] },
      }),
      true,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: "服务器内部错误",
      data: null,
    });
    await expect(
      env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json"),
    ).resolves.toEqual(futurePolicy);
  });

  it("returns 503 when patching an uninitialized policy", async () => {
    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: policy.revision,
        add: { names: ["王五"] },
      }),
      true,
    );

    expect(response.status).toBe(503);
  });

  it("returns 400 for a conflicting patch without changing KV", async () => {
    await seedPolicy();

    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: policy.revision,
        add: { studentIds: [" 23370003 "] },
        remove: { studentIds: ["23370003"] },
      }),
      true,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 0,
      msg: "请求数据格式错误",
      data: null,
    });
    await expect(
      env.API_PLATFORM_KV.get(ACCESS_POLICY_KEY, "json"),
    ).resolves.toEqual(policy);
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      true,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 0,
      data: null,
    });
  });

  it("returns 413 when the patch body exceeds 32 KiB", async () => {
    const body = JSON.stringify({
      baseRevision: policy.revision,
      add: { names: ["x".repeat(33 * 1024)] },
    });
    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
        },
        body,
      },
      true,
    );

    expect(response.status).toBe(413);
  });

  it("protects the administrator patch route", async () => {
    const response = await request(
      ADMIN_ACCESS_POLICY_PATH,
      jsonRequest("PATCH", {
        baseRevision: policy.revision,
        add: { names: ["王五"] },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 0,
      msg: "缺少 Cloudflare Access 凭证",
      data: null,
    });
  });

  it.each([
    [PUBLIC_ACCESS_POLICY_PATH, "POST", "GET"],
    [ADMIN_ACCESS_POLICY_PATH, "PUT", "PATCH"],
  ])("returns 405 for %s with %s", async (path, method, allowed) => {
    const response = await request(path, { method }, true);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allowed);
  });

  it.each([
    "/api/another-domain/v1/iclass/access-policy",
    "/api/buaa-classhopper/v1/another-resource",
  ])("does not match unrelated domain routes: %s", async (path) => {
    const response = await request(path);

    expect(response.status).toBe(404);
  });
});

async function seedPolicy(): Promise<void> {
  await env.API_PLATFORM_KV.put(ACCESS_POLICY_KEY, JSON.stringify(policy));
}

async function request(
  path: string,
  init?: RequestInit,
  useAuthenticatedApp = false,
): Promise<Response> {
  const application = createApp(
    useAuthenticatedApp ? authenticated : undefined,
    () => fixedNow,
  );
  return application.request(`https://example.com${path}`, init, env);
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
