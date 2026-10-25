import { env } from "cloudflare:workers";
import { expect, inject } from "vitest";
import { createApp } from "../src/app";
import { defineApps } from "../src/apps/registry";
import { bearerToken } from "../src/http/sso-auth";
import { ApiError } from "../src/http/errors";
import { emptyMembers, type Members, type Segment } from "../src/features/segments/schema";
import { ACCESS_POLICY_KEY } from "../src/domains/buaa-classhopper/access-policy/repository";

export const now = () => new Date("2026-10-24T00:00:00Z");
export const apps = defineApps([{ id: "buaa-classhopper", name: "BUAA" }, { id: "second_app", name: "Second" }]);
export const app = createApp(async () => ({ subject: "admin", email: null }), now, apps, async (request, _issuer, appId) => {
  const token = bearerToken(request);
  if (token === "unavailable") throw new ApiError("SSO 公钥暂时不可用", 503);
  if (token !== `valid-${appId}`) throw new ApiError("SSO 凭证无效", 401);
  return { userId: "user-1", clientId: "client" };
});
export async function migrate() { await env.API_PLATFORM_DB.batch(inject("segmentMigration").map((s) => env.API_PLATFORM_DB.prepare(s))); }
export async function clean() {
  await env.API_PLATFORM_DB.batch(["app_version_settings", "app_versions", "segments"].map((t) => env.API_PLATFORM_DB.prepare(`DELETE FROM ${t}`)));
  await env.API_PLATFORM_KV.delete(ACCESS_POLICY_KEY);
}
export async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`https://example.test${path}`, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}
export async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as { data: T; msg: string }; expect(response.status, body.msg).toBeLessThan(300); return body.data;
}
export const segment = (name = "测试人群", members: Partial<Members> = {}) => request("/api/admin/segments", "POST", { name, members: { ...emptyMembers(), ...members } }).then(read<Segment>);
