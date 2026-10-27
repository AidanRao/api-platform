import { z } from "zod";
import { ApiError } from "../../../http/errors";
import { signCheckinBody } from "../../../infrastructure/hmac";
import { courseSchema } from "./schema";

type ClientEnv = Pick<
  Env,
  | "ENVIRONMENT"
  | "ICLASS_SERVICE_BASE_URL"
  | "ICLASS_SERVICE_SECRET"
  | "ICLASS_PRIVATE_API"
>;
export const reasonError = (
  reason: string,
  message: string,
  status: 403 | 404 | 409 | 502 | 503 = 502,
) => new ApiError(message, status, { reason });
export class IclassClient {
  constructor(
    private readonly env: ClientEnv,
    private readonly now: () => Date,
  ) {}
  async schedule(loginName: string, date: string) {
    const data = await this.request(
      "/internal/iclass/course-schedules",
      "GET",
      { loginName, date },
    );
    const parsed = z.array(courseSchema).safeParse(data);
    if (!parsed.success)
      throw reasonError("ICLASS_INVALID_RESPONSE", "课表服务返回无效数据");
    return parsed.data;
  }
  async sign(loginName: string, courseScheduleId: string) {
    const data = await this.request("/internal/iclass/sign-ins", "POST", {
      loginName,
      courseScheduleId,
    });
    const parsed = z
      .object({
        courseScheduleId: z.string(),
        stuSignId: z.string().optional(),
        stuSignStatus: z.string().optional(),
      })
      .safeParse(data);
    if (!parsed.success || parsed.data.courseScheduleId !== courseScheduleId)
      throw reasonError(
        "SIGN_RESULT_UNKNOWN",
        "签到结果未确认，请刷新课表查看",
      );
    return parsed.data;
  }
  private async request(
    path: string,
    method: "GET" | "POST",
    input: Record<string, string>,
  ): Promise<unknown> {
    const {
      ICLASS_SERVICE_BASE_URL: base,
      ICLASS_SERVICE_SECRET: secret,
      ICLASS_PRIVATE_API: binding,
    } = this.env;
    if (!base || !secret || (this.env.ENVIRONMENT === "production" && !binding))
      throw reasonError("ICLASS_UNAVAILABLE", "课表服务尚未配置", 503);
    const url = new URL(path, base);
    const body = method === "POST" ? JSON.stringify(input) : "";
    if (method === "GET")
      Object.entries(input).forEach(([name, value]) =>
        url.searchParams.set(name, value),
      );
    const timestamp = String(this.now().getTime());
    const headers = {
      "Content-Type": "application/json",
      "X-Service-ID": "iclass-service",
      "X-Timestamp": timestamp,
      "X-Signature": await signCheckinBody(secret, timestamp, body),
    };
    let response: Response;
    try {
      const request = new Request(url, {
        method,
        headers,
        ...(method === "POST" ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(25_000),
      });
      response = await (this.env.ENVIRONMENT === "production"
        ? binding!.fetch(request)
        : fetch(request));
    } catch {
      throw reasonError(
        method === "POST" ? "SIGN_RESULT_UNKNOWN" : "ICLASS_NETWORK_ERROR",
        method === "POST"
          ? "签到结果未确认，请刷新课表查看"
          : "课表服务连接失败，请重试",
      );
    }
    let payload: { code?: number; success?: boolean; data?: unknown };
    try {
      const parsed = z
        .object({ code: z.number(), success: z.boolean(), data: z.unknown() })
        .safeParse(await response.json());
      if (!parsed.success) throw new Error("invalid envelope");
      payload = parsed.data;
    } catch {
      throw reasonError(
        method === "POST" ? "SIGN_RESULT_UNKNOWN" : "ICLASS_INVALID_RESPONSE",
        "服务返回无效响应，请刷新后重试",
      );
    }
    if (response.ok && payload.code === 0 && payload.success === true)
      return payload.data;
    switch (payload.code) {
      case 2002:
        throw reasonError(
          "ICLASS_AUTHORIZATION_INVALID",
          "iClass 授权已失效，请在 App 内重新授权",
          403,
        );
      case 2003:
        throw reasonError("SIGN_REJECTED", "iClass 拒绝本次签到", 409);
      case 2004:
        throw reasonError(
          "SIGN_RESULT_UNKNOWN",
          "签到结果未确认，请刷新课表查看",
        );
      case 1004:
        throw reasonError("ICLASS_BUSY", "课表服务繁忙，请稍后重试", 503);
      case 2001:
        throw reasonError(
          "ICLASS_UNAVAILABLE",
          "课表服务暂时无法连接校园网络",
          503,
        );
      default:
        throw reasonError(
          "ICLASS_UPSTREAM_ERROR",
          "课表服务暂时不可用，请稍后重试",
        );
    }
  }
}
