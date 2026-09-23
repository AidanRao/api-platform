import { z } from "zod";

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const envelope = z.object({ code: z.number(), msg: z.string(), data: z.unknown() });
export function createAdminClient(appId: string) {
  return createClient(`/api/admin/${encodeURIComponent(appId)}`);
}

export const platformClient = createClient("/api/admin");
function createClient(base: string) {
  return async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, { cache: "no-store", ...init });
    if (!response.headers.get("Content-Type")?.includes("application/json")) {
      throw new AdminApiError("登录状态可能已过期，请重新加载页面", response.status);
    }
    const result = envelope.safeParse(await response.json());
    if (!result.success) throw new Error("服务器返回了无法识别的响应");
    if (!response.ok || result.data.code !== 1) throw new AdminApiError(result.data.msg, response.status);
    return schema.parse(result.data.data);
  };
}
export const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
