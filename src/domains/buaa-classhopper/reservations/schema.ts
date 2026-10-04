import { z } from "zod";

const identifier = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^[1-9]\d*$/).max(32),
]).transform(String);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const courseFields = z.object({
  id: identifier,
  courseId: identifier,
  courseName: z.string().trim().min(1).max(200),
  courseNum: z.string().trim().max(100),
  classroomName: z.string().trim().max(200),
  classBeginTime: timestamp,
  classEndTime: timestamp,
}).strict();
const course = courseFields.refine((value) => value.classEndTime > value.classBeginTime, "课程结束时间必须晚于开始时间");

export const createReservationSchema = z.object({
  loginName: z.string().trim().min(1).max(128),
  studentId: z.string().trim().min(1).max(128),
  studentName: z.string().trim().min(1).max(128),
  course,
}).strict();

const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000));
export const reservationStatusSchema = z.enum(["QUEUED", "IN_PROGRESS", "SUCCESS", "FAILED", "CANCELLED"]);
export const reservationQuerySchema = z.object({
  page: pageNumber.default(1),
  pageSize: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).default(10),
});
export const adminReservationQuerySchema = reservationQuerySchema.extend({
  studentId: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  status: reservationStatusSchema.optional(),
});
export type CreateReservation = z.infer<typeof createReservationSchema>;
export type ReservationQuery = z.infer<typeof reservationQuerySchema>;
export type AdminReservationQuery = z.infer<typeof adminReservationQuerySchema>;

export const storedCourseSchema = courseFields.omit({ id: true });

export const reservationSchema = z.object({
  id: z.string(), userId: z.string(), loginName: z.string(), studentId: z.string(), studentName: z.string(),
  course: storedCourseSchema.extend({ id: z.string() }),
  status: reservationStatusSchema,
  nextAttemptAt: z.string().nullable(), attemptCount: z.number().int().nonnegative(),
  completedAt: z.string().nullable(), resultMessage: z.string().nullable(),
  resultCode: z.number().int().nullable(), resultData: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
export const checkinResultSchema = z.object({
  reservationId: z.string().min(1),
  attemptId: z.string().min(1),
  status: z.enum(["SUCCESS", "FAILED"]),
  code: z.number().int().nonnegative(),
  message: z.string().max(1000),
  data: z.record(z.string(), z.unknown()),
}).strict().refine((value) => (value.status === "SUCCESS") === (value.code === 0));
export type CheckinResult = z.infer<typeof checkinResultSchema>;
export const reservationPageSchema = z.object({
  items: z.array(reservationSchema), page: z.number().int(),
  pageSize: z.number().int(), total: z.number().int(),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const reservationEventSchema = z.object({
  scheduleVersion: z.number().int(),
  kind: z.enum(["SUBMITTED", "CANCELLED", "RESTORED", "MANUAL_TRIGGER",
    "RESCHEDULED", "SCHEDULED", "ATTEMPT_STARTED", "RESULT_SUCCESS", "RESULT_FAILED", "FINISHED_FAILED"]),
  referenceId: z.string().nullable().optional(), attemptNumber: z.number().int().nullable().optional(),
  occurredAt: z.string(), scheduledFor: z.string().nullable().optional(), message: z.string().nullable().optional(),
});
export const reservationEventsSchema = z.object({ items: z.array(reservationEventSchema) });
export type ReservationEvent = z.infer<typeof reservationEventSchema>;
