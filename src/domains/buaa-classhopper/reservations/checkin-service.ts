import { signCheckinBody } from "../../../infrastructure/hmac";
import { CHECKIN_TIMEOUT_SECONDS } from "./checkin-policy";
import { checkinResultSchema, type CheckinResult } from "./schema";

export async function executeCheckin(
  serviceUrl: string, secret: string, reservationId: string, attemptId: string,
  send: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now,
): Promise<CheckinResult> {
  if (!serviceUrl || !secret || !reservationId || !attemptId) throw new Error("check-in service configuration is missing");
  const body = JSON.stringify({ reservationId, attemptId });
  const timestamp = String(now());
  try {
    const response = await send(new URL("/internal/checkin-executions", serviceUrl), {
      method: "POST",
      signal: AbortSignal.timeout(CHECKIN_TIMEOUT_SECONDS * 1000),
      headers: {
        "Content-Type": "application/json",
        "X-Service-ID": "iclass-service",
        "X-Timestamp": timestamp,
        "X-Signature": await signCheckinBody(secret, timestamp, body),
      },
      body,
    });
    if (response.status !== 200) return failure(response.status, `签到服务返回 HTTP ${response.status}`);
    const payload = await response.json() as { code?: number; success?: boolean; data?: unknown };
    if (payload.code !== 0 || payload.success !== true) return failure(502, "签到服务返回无效响应");
    const parsed = checkinResultSchema.safeParse(payload.data);
    if (!parsed.success || parsed.data.reservationId !== reservationId || parsed.data.attemptId !== attemptId) {
      return failure(502, "签到服务返回无效结果");
    }
    return parsed.data;
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return failure(timeout ? 408 : 502,
      timeout ? `等待签到服务超过 ${CHECKIN_TIMEOUT_SECONDS} 秒` : "签到服务请求失败");
  }

  function failure(code: number, message: string): CheckinResult {
    return { reservationId, attemptId, status: "FAILED", code, message, data: {} };
  }
}
