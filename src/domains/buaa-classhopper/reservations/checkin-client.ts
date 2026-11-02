import { executeCheckin } from "./checkin-service";
import { IclassNodePool, type IclassNodeEnv } from "../iclass/node-pool";

export function createCheckinClient<T extends IclassNodeEnv>(env: T) {
  const { ICLASS_SERVICE_BASE_URL: url, ICLASS_SERVICE_SECRET: secret } = env;
  if (!url || !secret) {
    throw new Error("check-in service configuration is missing: ICLASS_SERVICE_BASE_URL or ICLASS_SERVICE_SECRET");
  }
  const pool = new IclassNodePool(env);

  return (reservationId: string, attemptId: string, loginName: string) =>
    executeCheckin(url, secret, reservationId, attemptId,
      (input, init) => pool.fetch(new Request(input, init), loginName, "checkin"));
}
