import { executeCheckin } from "./checkin-service";

type CheckinClientEnv = Pick<Env, "ENVIRONMENT" | "ICLASS_SERVICE_BASE_URL" | "ICLASS_SERVICE_SECRET"> & {
  ICLASS_PRIVATE_API?: Pick<NonNullable<Env["ICLASS_PRIVATE_API"]>, "fetch">;
};

export function createCheckinClient(env: CheckinClientEnv) {
  const { ICLASS_SERVICE_BASE_URL: url, ICLASS_SERVICE_SECRET: secret } = env;
  if (!url || !secret) {
    throw new Error("check-in service configuration is missing: ICLASS_SERVICE_BASE_URL or ICLASS_SERVICE_SECRET");
  }
  let send: typeof fetch = (input, init) => fetch(input, init);
  if (env.ENVIRONMENT === "production") {
    const service = env.ICLASS_PRIVATE_API;
    if (!service) throw new Error("check-in service configuration is missing: ICLASS_PRIVATE_API");
    send = (input, init) => service.fetch(input, init);
  }

  return (reservationId: string, attemptId: string) =>
    executeCheckin(url, secret, reservationId, attemptId, send);
}
