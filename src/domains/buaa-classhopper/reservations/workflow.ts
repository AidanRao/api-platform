import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { ReservationRepository } from "./repository";
import { enqueueCheckinExecution } from "./checkin-service";
import { CHECKIN_TIMEOUT_SECONDS, MAX_CHECKIN_RETRIES } from "./checkin-policy";
import { retryDelay } from "./timing";

type Params = { reservationId: string; version: number };
const minute = 60_000;

type CheckinEnv = Env & { ICLASS_SERVICE_SECRET: string };

export class IclassCheckinWorkflow extends WorkflowEntrypoint<CheckinEnv, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<void> {
    const { reservationId, version } = event.payload;
    const callbackTimeout = CHECKIN_TIMEOUT_SECONDS * 1000;
    const repository = new ReservationRepository(this.env.API_PLATFORM_DB);
    const load = async () => snapshot(await repository.get(reservationId));
    const initial = await step.do("load reservation", load);
    if (!initial || initial.scheduleVersion !== version) return;
    if (initial.nextAttemptAt) {
      const target = Date.parse(initial.nextAttemptAt);
      const anchor = await step.do("schedule anchor", async () => Date.now());
      if (target > anchor) {
        const chunk = 360 * 24 * 60 * minute;
        for (let at = anchor + chunk, index = 0; at < target; at += chunk, index += 1) {
          await step.sleepUntil(`long-wait-${index}`, at);
        }
        const remaining = target - await step.do("final schedule anchor", async () => Date.now());
        if (remaining > 0 && remaining < 5_000) await step.sleep("first check-in time", remaining);
        else if (remaining >= 5_000) await step.sleepUntil("first check-in time", target);
      }
    }
    else if (initial.status !== "IN_PROGRESS") return;

    // Include one final inspection after the last allowed attempt.
    for (let cycle = 0; cycle < MAX_CHECKIN_RETRIES + 2; cycle += 1) {
      const current = await step.do(`inspect-${cycle}`, load);
      if (!current || current.scheduleVersion !== version ||
        current.status === "SUCCESS" || current.status === "FAILED" || current.status === "CANCELLED") return;
      const deadline = new Date(current.classEndTime).getTime();
      if (Date.now() >= deadline) {
        console.info(JSON.stringify({ message: "check-in deadline reached before delivery", reservationId, version }));
        await step.do(`expire-${cycle}`, () => repository.finishFailed(reservationId, version,
          new Date(), "签到重试时间已结束"));
        return;
      }

      if (current.status === "QUEUED" && current.nextAttemptAt) {
        const next = new Date(current.nextAttemptAt);
        if (next.getTime() >= deadline) {
          await step.do(`failed-${cycle}`, () => repository.finishFailed(reservationId, version,
            new Date(), current.resultMessage ?? "签到失败"));
          return;
        }
        if (next.getTime() > Date.now()) await step.sleepUntil(`retry-delay-${cycle}`, next);
      }

      if (!this.env.ICLASS_SERVICE_BASE_URL || !this.env.ICLASS_SERVICE_SECRET) {
        throw new Error("check-in service configuration is missing: ICLASS_SERVICE_BASE_URL or ICLASS_SERVICE_SECRET");
      }

      let attempt = current.status === "IN_PROGRESS" && current.activeAttemptId && current.resultCode === null
        ? current : null;
      if (!attempt) attempt = await step.do(`begin-${cycle}`, async () =>
        snapshot(await repository.beginAttempt(reservationId, version, new Date())));
      if (!attempt?.activeAttemptId) return;
      const attemptId = attempt.activeAttemptId;
      const timeoutAt = Date.parse(attempt.updatedAt) + callbackTimeout;
      console.info(JSON.stringify({ message: "check-in attempt started", reservationId, attemptId }));
      for (let delivery = 0; delivery < 100; delivery += 1) {
        const latest = await step.do(`before-delivery-${cycle}-${delivery}`, load);
        if (!latest || latest.scheduleVersion !== version || latest.status !== "IN_PROGRESS" ||
          latest.activeAttemptId !== attemptId || latest.resultCode !== null) break;
        if (Date.now() >= deadline) break;
        if (Date.now() >= timeoutAt) {
          await step.do(`callback-timeout-${cycle}`, async () => {
            await repository.timeoutAttempt(reservationId, attemptId, new Date());
          });
          break;
        }
        await step.do(`deliver-${cycle}-${delivery}`, async () => {
          try {
            const response = await enqueueCheckinExecution(this.env.ICLASS_SERVICE_BASE_URL,
              this.env.ICLASS_SERVICE_SECRET, reservationId, attemptId);
            if (response.status !== 202) throw new Error(`check-in service returned HTTP ${response.status}`);
            const payload = await response.json() as { code?: number; success?: boolean; data?: { attemptId?: string } };
            if (payload.code !== 0 || payload.success !== true || payload.data?.attemptId !== attemptId) {
              throw new Error("check-in service returned an invalid acknowledgement");
            }
            console.info(JSON.stringify({ message: "check-in delivery accepted", reservationId, attemptId }));
          } catch (error) {
            console.error(JSON.stringify({ message: "check-in delivery failed", reservationId, attemptId,
              error: error instanceof Error ? error.message : String(error) }));
          }
        });
        const delay = retryDelay(delivery + 1);
        await step.sleep(`callback-watch-${cycle}-${delivery}`,
          Math.min(delay, Math.max(1, Math.min(deadline, timeoutAt) - Date.now())));
      }
    }
    throw new Error("check-in workflow exceeded its attempt limit");
  }
}

function snapshot(value: Awaited<ReturnType<ReservationRepository["get"]>>) {
  if (!value) return null;
  return {
    id: value.id, status: value.status, scheduleVersion: value.scheduleVersion,
    classEndTime: value.course.classEndTime, nextAttemptAt: value.nextAttemptAt,
    attemptCount: value.attemptCount, activeAttemptId: value.activeAttemptId, updatedAt: value.updatedAt,
    resultCode: value.resultCode, resultMessage: value.resultMessage,
  };
}

export function workflowId(reservationId: string, version: number): string {
  return `${reservationId}-${version}`;
}

export async function ensureWorkflow(env: Env, reservationId: string, version: number): Promise<void> {
  const id = workflowId(reservationId, version);
  try {
    await env.ICLASS_CHECKIN_WORKFLOW.create({ id, params: { reservationId, version } });
  } catch (error) {
    // create() rejects an existing ID; get() confirms that this is the expected instance.
    const existing = await env.ICLASS_CHECKIN_WORKFLOW.get(id).catch(() => null);
    if (!existing) throw error;
  }
  await new ReservationRepository(env.API_PLATFORM_DB).markWorkflow(reservationId, version, id);
}

export async function terminateWorkflow(env: Env, instanceId: string | null): Promise<void> {
  if (!instanceId) return;
  try {
    const instance = await env.ICLASS_CHECKIN_WORKFLOW.get(instanceId);
    const state = await instance.status();
    if (["complete", "terminated"].includes(state.status)) return;
    if (state.status === "errored") {
      console.warn(JSON.stringify({ message: "old check-in workflow errored", instanceId,
        error: state.error?.message ?? "unknown error" }));
      return;
    }
    await instance.terminate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("instance.not_found") || message.includes("instance.cannot_terminate")) return;
    console.warn(JSON.stringify({ message: "old check-in workflow termination failed", instanceId,
      error: message }));
  }
}

export async function reconcileWorkflows(env: Env): Promise<void> {
  const repository = new ReservationRepository(env.API_PLATFORM_DB);
  const timeoutMs = CHECKIN_TIMEOUT_SECONDS * 1000;
  let afterId = "";
  while (true) {
    const page = await repository.active(afterId);
    if (!page.length) break;
    for (const reservation of page) {
      const deadline = new Date(reservation.course.classEndTime).getTime();
      if (Date.now() >= deadline) {
        await repository.finishFailed(reservation.id, reservation.scheduleVersion, new Date(), "签到重试时间已结束");
        continue;
      }
      if (reservation.status === "IN_PROGRESS" && reservation.activeAttemptId && reservation.resultCode === null &&
        Date.now() >= Date.parse(reservation.updatedAt) + timeoutMs) {
        await repository.timeoutAttempt(reservation.id, reservation.activeAttemptId, new Date());
      }
      if (!reservation.workflowInstanceId) {
        await ensureWorkflow(env, reservation.id, reservation.scheduleVersion);
        continue;
      }
      const instance = await env.ICLASS_CHECKIN_WORKFLOW.get(reservation.workflowInstanceId).catch(() => null);
      const status = await instance?.status().catch(() => null);
      if (!instance) await ensureWorkflow(env, reservation.id, reservation.scheduleVersion);
      else if (status && ["errored", "terminated", "complete"].includes(status.status)) await instance.restart();
    }
    afterId = page[page.length - 1]!.id;
  }
}
