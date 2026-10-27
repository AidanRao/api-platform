import { z } from "zod";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00+08:00`);
    return Number.isFinite(parsed.getTime()) && shanghaiDate(parsed) === value;
  }, "日期无效");
export const authorizationSchema = z
  .object({ loginName: z.string().trim().min(1).max(4096) })
  .strict();
export const signInSchema = z
  .object({
    date: dateSchema,
    courseScheduleId: z.string().trim().min(1).max(100),
    allowOutsideWindow: z.boolean().default(false),
  })
  .strict();
export const courseSchema = z.object({
  courseScheduleId: z.string().min(1),
  courseId: z.string(),
  courseName: z.string(),
  courseType: z.string(),
  weekDay: z.string(),
  courseNum: z.string(),
  teacherName: z.array(z.string()),
  classroomName: z.array(z.string()),
  signStatus: z.number().int(),
  classBeginTime: z.string(),
  classEndTime: z.string(),
});
export type IclassCourse = z.infer<typeof courseSchema>;
export function shanghaiDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function courseTime(value: string): number {
  const normalized = value.replace(" ", "T");
  return Date.parse(
    /[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}+08:00`,
  );
}
