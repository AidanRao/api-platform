import { signCheckinBody } from "../../../infrastructure/hmac";

export async function enqueueCheckinExecution(
  serviceUrl: string, secret: string, reservationId: string, attemptId: string,
  send: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now,
): Promise<Response> {
  if (!serviceUrl || !secret || !reservationId || !attemptId) throw new Error("check-in service configuration is missing");
  const body = JSON.stringify({ reservationId, attemptId });
  const timestamp = String(now());
  return send(new URL("/internal/checkin-executions", serviceUrl), {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      "X-Service-ID": "iclass-service",
      "X-Timestamp": timestamp,
      "X-Signature": await signCheckinBody(secret, timestamp, body),
    },
    body,
  });
}
