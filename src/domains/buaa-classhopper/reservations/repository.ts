import type { AdminReservationQuery, CheckinResult, CreateReservation, ReservationEvent, ReservationQuery } from "./schema";
import { reservationEventSchema, reservationStatusSchema, storedCourseSchema } from "./schema";
import { generatePublicId } from "../../../infrastructure/public-id";
import { CHECKIN_TIMEOUT_SECONDS, MAX_CHECKIN_RETRIES, MAX_RESERVATIONS_PER_USER, RESERVATION_WINDOW_MS, scheduledTime } from "./checkin-policy";
import { retryDelay } from "./timing";

type Row = {
  id: string; userId: string; loginName: string; studentId: string; studentName: string;
  courseScheduleId: string; courseJson: string; status: string;
  nextAttemptAt: string | null; attemptCount: number; completedAt: string | null;
  resultMessage: string | null; resultCode: number | null; resultDataJson: string | null;
  scheduleVersion: number; workflowInstanceId: string | null; activeAttemptId: string | null;
  createdAt: string; updatedAt: string;
};
const columns = `id, user_id AS userId, login_name AS loginName, student_id AS studentId, student_name AS studentName,
  course_schedule_id AS courseScheduleId, course_json AS courseJson, status,
  next_attempt_at AS nextAttemptAt, attempt_count AS attemptCount, completed_at AS completedAt,
  result_message AS resultMessage, result_code AS resultCode, result_data_json AS resultDataJson,
  schedule_version AS scheduleVersion, workflow_instance_id AS workflowInstanceId,
  active_attempt_id AS activeAttemptId, created_at AS createdAt, updated_at AS updatedAt`;
const quotaFilter = "user_id = ? AND status NOT IN ('SUCCESS', 'FAILED')";
function decode(row: Row) {
  const course = storedCourseSchema.parse(JSON.parse(row.courseJson));
  return {
    id: row.id, userId: row.userId, loginName: row.loginName, studentId: row.studentId, studentName: row.studentName,
    course: { id: row.courseScheduleId, ...course },
    status: reservationStatusSchema.parse(row.status),
    nextAttemptAt: row.nextAttemptAt, attemptCount: row.attemptCount,
    completedAt: row.completedAt, resultMessage: row.resultMessage,
    resultCode: row.resultCode, resultData: row.resultDataJson ? JSON.parse(row.resultDataJson) as Record<string, unknown> : null,
    scheduleVersion: row.scheduleVersion, workflowInstanceId: row.workflowInstanceId, activeAttemptId: row.activeAttemptId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function eventJson(kind: ReservationEvent["kind"], scheduleVersion: number, occurredAt: string,
  details: Partial<Pick<ReservationEvent, "referenceId" | "attemptNumber" | "scheduledFor" | "message">> = {}) {
  return JSON.stringify({ kind, scheduleVersion, occurredAt, ...details });
}

export class ReservationRepository {
  constructor(private readonly db: D1Database, private readonly idGenerator = generatePublicId) {}

  async get(id: string) {
    const row = await this.db.prepare(`SELECT ${columns} FROM buaa_classhopper_reservations WHERE id = ?`)
      .bind(id).first<Row>();
    return row ? decode(row) : null;
  }

  async events(id: string) {
    const row = await this.db.prepare("SELECT events_json AS eventsJson FROM buaa_classhopper_reservations WHERE id = ?")
      .bind(id).first<{ eventsJson: string }>();
    return row ? reservationEventSchema.array().parse(JSON.parse(row.eventsJson)) : null;
  }

  async list(userId: string, query: ReservationQuery) {
    const [count, page] = await this.db.batch<Record<string, unknown>>([
      this.db.prepare("SELECT COUNT(*) AS total FROM buaa_classhopper_reservations WHERE user_id = ?").bind(userId),
      this.db.prepare(`SELECT ${columns} FROM buaa_classhopper_reservations WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(userId, query.pageSize, (query.page - 1) * query.pageSize),
    ]);
    return {
      items: (page!.results as Row[]).map(decode), page: query.page,
      pageSize: query.pageSize, total: Number(count!.results[0]!.total),
    };
  }

  async listAll(query: AdminReservationQuery) {
    const conditions: string[] = [];
    const values: string[] = [];
    if (query.studentId) { conditions.push("student_id = ?"); values.push(query.studentId); }
    if (query.search) {
      conditions.push(`(instr(lower(id), lower(?)) > 0 OR instr(lower(student_name), lower(?)) > 0
        OR instr(lower(student_id), lower(?)) > 0
        OR instr(lower(json_extract(course_json, '$.courseName')), lower(?)) > 0)`);
      values.push(query.search, query.search, query.search, query.search);
    }
    if (query.status) { conditions.push("status = ?"); values.push(query.status); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const countStatement = this.db.prepare(`SELECT COUNT(*) AS total FROM buaa_classhopper_reservations${where}`);
    const [count, page] = await this.db.batch<Record<string, unknown>>([
      values.length ? countStatement.bind(...values) : countStatement,
      this.db.prepare(`SELECT ${columns} FROM buaa_classhopper_reservations${where}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(...values, query.pageSize, (query.page - 1) * query.pageSize),
    ]);
    return {
      items: (page!.results as Row[]).map(decode), page: query.page,
      pageSize: query.pageSize, total: Number(count!.results[0]!.total),
    };
  }

  async createOrUpdate(userId: string, input: CreateReservation, now: Date) {
    if (Date.parse(input.course.classBeginTime) > now.getTime() + RESERVATION_WINDOW_MS) return null;
    const key = [userId, input.loginName, input.course.id] as const;
    const existing = await this.byKey(...key);
    const deadline = new Date(input.course.classBeginTime).getTime() - 10 * 60_000;
    const current = existing ? decode(existing) : null;
    if (current?.status === "CANCELLED") return { reservation: current, created: false, updated: false };
    const currentClosed = current && now.getTime() >= new Date(current.course.classBeginTime).getTime() - 10 * 60_000;
    if (current && (now.getTime() >= deadline || currentClosed)) {
      return { reservation: current, created: false, updated: false };
    }
    if (now.getTime() >= deadline) return null;
    const timestamp = now.toISOString();
    const firstAttemptAt = scheduledTime(input.course.classBeginTime);
    const { id: courseScheduleId, ...course } = input.course;
    const courseJson = JSON.stringify(course);
    let businessKeyConflict = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = this.idGenerator("RSV", now, "Asia/Shanghai");
      const result = await this.db.prepare(`INSERT OR IGNORE INTO buaa_classhopper_reservations
        (id, user_id, login_name, student_id, student_name, course_schedule_id, course_json,
         schedule_version, next_attempt_at, created_at, updated_at, events_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, json_array(json(?))
        WHERE (SELECT COUNT(*) FROM buaa_classhopper_reservations WHERE ${quotaFilter}) < ?`)
        .bind(id, userId, input.loginName, input.studentId, input.studentName, courseScheduleId,
          courseJson, firstAttemptAt, timestamp, timestamp, eventJson("SUBMITTED", 1, timestamp),
          userId, MAX_RESERVATIONS_PER_USER).run();
      if (result.meta.changes === 1) {
        const inserted = await this.byKey(...key);
        if (!inserted) throw new Error("Inserted reservation not found");
        return { reservation: decode(inserted), created: true, updated: false };
      }
      // A business-key conflict is a repeat request; an ID conflict needs another random ID.
      businessKeyConflict = Boolean(await this.byKey(...key));
      if (businessKeyConflict) break;
      const count = await this.db.prepare(`SELECT COUNT(*) AS total FROM buaa_classhopper_reservations WHERE ${quotaFilter}`)
        .bind(userId).first<{ total: number }>();
      if (Number(count?.total) >= MAX_RESERVATIONS_PER_USER) return { limitReached: true as const };
    }
    if (!businessKeyConflict) throw new Error("Unable to generate a unique reservation ID");
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET student_id = ?, student_name = ?, course_json = ?, updated_at = ?,
          status = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN 'QUEUED' ELSE status END,
          attempt_count = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN 0 ELSE attempt_count END,
          active_attempt_id = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN NULL ELSE active_attempt_id END,
          result_code = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN NULL ELSE result_code END,
          result_message = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN NULL ELSE result_message END,
          result_data_json = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN NULL ELSE result_data_json END,
          completed_at = CASE WHEN json_extract(course_json, '$.classBeginTime') <> ? THEN NULL ELSE completed_at END,
          schedule_version = CASE WHEN schedule_version > 0 AND json_extract(course_json, '$.classBeginTime') <> ?
            THEN schedule_version + 1 ELSE schedule_version END,
          workflow_instance_id = CASE WHEN schedule_version > 0 AND json_extract(course_json, '$.classBeginTime') <> ?
            THEN NULL ELSE workflow_instance_id END,
          next_attempt_at = CASE WHEN schedule_version > 0 AND json_extract(course_json, '$.classBeginTime') <> ?
            THEN ? ELSE next_attempt_at END,
          events_json = CASE WHEN schedule_version > 0 AND json_extract(course_json, '$.classBeginTime') <> ?
            THEN json_insert(events_json, '$[#]', json_object(
              'kind', 'RESCHEDULED', 'scheduleVersion', schedule_version + 1,
              'occurredAt', ?, 'scheduledFor', ?)) ELSE events_json END
      WHERE user_id = ? AND login_name = ? AND course_schedule_id = ? AND status IN ('QUEUED', 'IN_PROGRESS')
        AND json_extract(course_json, '$.classBeginTime') > ?
      RETURNING ${columns}`).bind(input.studentId, input.studentName, courseJson, timestamp,
        input.course.classBeginTime, input.course.classBeginTime, input.course.classBeginTime,
        input.course.classBeginTime, input.course.classBeginTime, input.course.classBeginTime,
        input.course.classBeginTime,
        input.course.classBeginTime, input.course.classBeginTime, input.course.classBeginTime,
        firstAttemptAt, input.course.classBeginTime, timestamp, firstAttemptAt,
        ...key,
        new Date(now.getTime() + 10 * 60_000).toISOString()).first<Row>();
    if (row) return { reservation: decode(row), created: false, updated: true };
    const unchanged = await this.byKey(...key);
    if (!unchanged) throw new Error("Existing reservation not found");
    return { reservation: decode(unchanged), created: false, updated: false };
  }

  private byKey(userId: string, loginName: string, scheduleId: string) {
    return this.db.prepare(`SELECT ${columns} FROM buaa_classhopper_reservations
      WHERE user_id = ? AND login_name = ? AND course_schedule_id = ?`)
      .bind(userId, loginName, scheduleId).first<Row>();
  }

  async markWorkflow(id: string, version: number, instanceId: string) {
    await this.db.prepare(`UPDATE buaa_classhopper_reservations SET workflow_instance_id = ?,
      events_json = CASE WHEN workflow_instance_id IS NULL OR workflow_instance_id <> ?
        THEN json_insert(events_json, '$[#]', json_object(
          'kind', 'SCHEDULED', 'scheduleVersion', schedule_version,
          'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          'referenceId', ?, 'scheduledFor', next_attempt_at))
        ELSE events_json END
      WHERE id = ? AND schedule_version = ?`)
      .bind(instanceId, instanceId, instanceId, id, version).run();
  }

  async active(afterId = "", limit = 100) {
    const rows = await this.db.prepare(`SELECT ${columns} FROM buaa_classhopper_reservations
      WHERE schedule_version > 0 AND status IN ('QUEUED', 'IN_PROGRESS') AND id > ?
      ORDER BY id LIMIT ?`).bind(afterId, limit).all<Row>();
    return rows.results.map(decode);
  }

  async cancel(id: string, version: number, now: Date) {
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = 'CANCELLED', schedule_version = schedule_version + 1,
          workflow_instance_id = NULL, active_attempt_id = NULL, next_attempt_at = NULL,
          result_code = NULL, result_message = NULL, result_data_json = NULL,
          completed_at = ?, updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json(?))
      WHERE id = ? AND schedule_version = ? AND status IN ('QUEUED', 'FAILED')
      RETURNING ${columns}`).bind(now.toISOString(), now.toISOString(),
        eventJson("CANCELLED", version + 1, now.toISOString()), id, version).first<Row>();
    return row ? decode(row) : null;
  }

  async restore(id: string, version: number, now: Date, firstAttemptAt: string) {
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = 'QUEUED', schedule_version = schedule_version + 1,
          workflow_instance_id = NULL, active_attempt_id = NULL,
          next_attempt_at = ?,
          attempt_count = 0, result_code = NULL, result_message = NULL, result_data_json = NULL,
          completed_at = NULL, updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json(?))
      WHERE id = ? AND schedule_version = ? AND status = 'CANCELLED'
        AND json_extract(course_json, '$.classEndTime') > ?
      RETURNING ${columns}`).bind(firstAttemptAt, now.toISOString(),
        eventJson("RESTORED", version + 1, now.toISOString(), { scheduledFor: firstAttemptAt }),
        id, version, now.toISOString()).first<Row>();
    return row ? decode(row) : null;
  }

  async triggerNow(id: string, version: number, now: Date) {
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = 'QUEUED', schedule_version = schedule_version + 1,
          workflow_instance_id = NULL, active_attempt_id = NULL, next_attempt_at = ?,
          attempt_count = 0, result_code = NULL, result_message = NULL, result_data_json = NULL,
          completed_at = NULL, updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json(?))
      WHERE id = ? AND schedule_version = ? AND status IN ('QUEUED', 'FAILED')
        AND json_extract(course_json, '$.classEndTime') > ?
      RETURNING ${columns}`).bind(now.toISOString(), now.toISOString(),
        eventJson("MANUAL_TRIGGER", version + 1, now.toISOString(), { scheduledFor: now.toISOString() }),
        id, version, now.toISOString()).first<Row>();
    return row ? decode(row) : null;
  }

  async delete(id: string, userId?: string) {
    const row = await this.db.prepare(`DELETE FROM buaa_classhopper_reservations
      WHERE id = ? AND (? IS NULL OR user_id = ?) RETURNING ${columns}`)
      .bind(id, userId ?? null, userId ?? null).first<Row>();
    return row ? decode(row) : null;
  }

  async beginAttempt(id: string, version: number, now: Date) {
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = 'IN_PROGRESS', attempt_count = attempt_count + 1,
          active_attempt_id = id || ':' || schedule_version || ':' || (attempt_count + 1),
          next_attempt_at = NULL, result_code = NULL, result_message = NULL,
          result_data_json = NULL, updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json_object(
            'kind', 'ATTEMPT_STARTED', 'scheduleVersion', schedule_version,
            'occurredAt', ?, 'referenceId', id || ':' || schedule_version || ':' || (attempt_count + 1),
            'attemptNumber', attempt_count + 1))
      WHERE id = ? AND schedule_version = ? AND status = 'QUEUED' AND attempt_count <= ?
        AND json_extract(course_json, '$.classEndTime') > ?
      RETURNING ${columns}`).bind(now.toISOString(), now.toISOString(), id, version,
        MAX_CHECKIN_RETRIES, now.toISOString()).first<Row>();
    return row ? decode(row) : null;
  }

  async completeAttempt(id: string, result: CheckinResult, now: Date) {
    const current = await this.get(id);
    if (!current) return null;
    if (result.reservationId !== id || current.status !== 'IN_PROGRESS' ||
      result.attemptId !== `${id}:${current.scheduleVersion}:${current.attemptCount}` ||
      current.activeAttemptId !== result.attemptId || current.resultCode !== null) return current;
    const version = current.scheduleVersion;
    const retryAt = result.status === 'FAILED' && current.attemptCount <= MAX_CHECKIN_RETRIES
      ? new Date(now.getTime() + retryDelay(current.attemptCount)) : null;
    const deadline = new Date(current.course.classEndTime).getTime();
    const terminal = retryAt === null || retryAt.getTime() >= deadline;
    const status = result.status === 'SUCCESS' ? 'SUCCESS' : terminal ? 'FAILED' : 'QUEUED';
    const nextAttemptAt = retryAt && !terminal ? retryAt.toISOString() : null;
    const row = await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = ?,
          result_code = ?, result_message = ?, result_data_json = ?,
          completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
          next_attempt_at = ?,
          updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json(?))
      WHERE id = ? AND schedule_version = ? AND status = 'IN_PROGRESS'
        AND active_attempt_id = ? AND result_code IS NULL
      RETURNING ${columns}`).bind(status, result.code, result.message,
        JSON.stringify(result.data), terminal ? 1 : 0, now.toISOString(), nextAttemptAt,
        now.toISOString(), eventJson(result.status === "SUCCESS" ? "RESULT_SUCCESS" : "RESULT_FAILED",
          version, now.toISOString(), { referenceId: result.attemptId, scheduledFor: nextAttemptAt, message: result.message }),
        id, version, result.attemptId).first<Row>();
    return row ? decode(row) : this.get(id);
  }

  timeoutAttempt(id: string, attemptId: string, now: Date) {
    return this.completeAttempt(id, {
      reservationId: id, attemptId, status: "FAILED", code: 408,
      message: `等待签到结果超过 ${CHECKIN_TIMEOUT_SECONDS} 秒`, data: {},
    }, now);
  }

  async finishFailed(id: string, version: number, now: Date, message: string) {
    await this.db.prepare(`UPDATE buaa_classhopper_reservations
      SET status = 'FAILED', next_attempt_at = NULL, completed_at = ?, result_message = ?, updated_at = ?,
          events_json = json_insert(events_json, '$[#]', json(?))
      WHERE id = ? AND schedule_version = ? AND status IN ('QUEUED', 'IN_PROGRESS')`)
      .bind(now.toISOString(), message, now.toISOString(),
        eventJson("FINISHED_FAILED", version, now.toISOString(), { message }), id, version).run();
  }
}
