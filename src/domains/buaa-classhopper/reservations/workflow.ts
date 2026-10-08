import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { ReservationRepository } from "./repository";
import { createCheckinClient } from "./checkin-client";
import { CHECKIN_TIMEOUT_SECONDS, MAX_CHECKIN_RETRIES } from "./checkin-policy";
import { checkinResultSchema } from "./schema";

type Params = { reservationId: string; version: number };
const minute = 60_000;

type CheckinEnv = Env & { ICLASS_SERVICE_SECRET: string };

export class IclassCheckinWorkflow extends WorkflowEntrypoint<CheckinEnv, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<void> {
    const { reservationId, version } = event.payload;
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

      const checkin = createCheckinClient(this.env);

      let attempt = current.status === "IN_PROGRESS" && current.activeAttemptId && current.resultCode === null
        ? current : null;
      if (!attempt) attempt = await step.do(`begin-${cycle}`, async () =>
        snapshot(await repository.beginAttempt(reservationId, version, new Date())));
      if (!attempt?.activeAttemptId) return;
      const attemptId = attempt.activeAttemptId;
      console.info(JSON.stringify({ message: "check-in attempt started", reservationId, attemptId }));
      const resultJson = await step.do(`execute-${cycle}`, {
        retries: { limit: 0, delay: 1_000 }, timeout: (CHECKIN_TIMEOUT_SECONDS + 5) * 1000,
      }, async () => JSON.stringify(await checkin(reservationId, attemptId)));
      const result = checkinResultSchema.parse(JSON.parse(resultJson));
      console.info(JSON.stringify({ message: "check-in attempt completed", reservationId, attemptId,
        status: result.status, code: result.code }));
      await step.do(`complete-${cycle}`, async () => {
        await repository.completeAttempt(reservationId, result, new Date());
      });
    }
    throw new Error("check-in workflow exceeded its attempt limit");
  }
}

function snapshot(value: Awaited<ReturnType<ReservationRepository["get"]>>) {
  if (!value) return null;
  return {
    id: value.id, status: value.status, scheduleVersion: value.scheduleVersion,
    classEndTime: value.course.classEndTime, nextAttemptAt: value.nextAttemptAt,
    activeAttemptId: value.activeAttemptId,
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
  // Leave time for the 60-second request and its D1 result update to finish.
  const recoveryMs = (CHECKIN_TIMEOUT_SECONDS + 15) * 1000;
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
        Date.now() >= Date.parse(reservation.updatedAt) + recoveryMs) {
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
