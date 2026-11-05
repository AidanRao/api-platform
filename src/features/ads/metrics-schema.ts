import { z } from "zod";

export const shanghaiDay = (ms = Date.now()) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00+08:00`);
export const addDays = (day: string, days: number) => shanghaiDay(dayStart(day) + days * 86_400_000);
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择有效日期")
  .refine((day) => Number.isFinite(dayStart(day)) && shanghaiDay(dayStart(day)) === day, "请选择有效日期");
export const metricsRangeSchema = z.object({ from_day: daySchema, to_day: daySchema }).strict();
export type MetricsRange = z.infer<typeof metricsRangeSchema>;
export function validMetricsRange(range: MetricsRange, now = Date.now()) {
  const today = shanghaiDay(now);
  return range.from_day < range.to_day && range.from_day >= addDays(today, -89) && range.to_day <= addDays(today, 1);
}
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(100);
const average = z.number().finite().nonnegative().nullable();
const metrics = z.object({
  impressions: count, clicks: count, ctr: average,
  impression_users: count, click_users: count, identified_impressions: count,
  avg_impressions_per_user: average, avg_visible_duration_ms: average,
  closed_shows: count, total_visible_duration_ms: count,
});
export const placementMetricsSchema = z.object({
  app_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), ads_app_id: id, placement_id: id,
  from_day: daySchema, to_day: daySchema,
  summary: metrics,
  daily: z.array(metrics.extend({ day: daySchema })).max(90),
  coverage: z.object({
    source: z.literal("durable_object"), time_basis: z.literal("received_at_ms"), timezone: z.literal("Asia/Shanghai"),
    retention_days: z.literal(90), stats_started_at_ms: count, extended_stats_started_at_ms: count, available_from_day: daySchema,
    complete_from_day: daySchema, ongoing: z.boolean(), is_complete: z.boolean(),
  }),
}).superRefine((result, ctx) => {
  const days = (dayStart(result.to_day) - dayStart(result.from_day)) / 86_400_000;
  if (days < 1 || days > 90 || result.daily.length !== days
      || result.daily.some((row, i) => row.day !== addDays(result.from_day, i))) {
    ctx.addIssue({ code: "custom", message: "统计日期不完整" });
  }
  const additive = ["impressions", "clicks", "identified_impressions", "closed_shows", "total_visible_duration_ms"] as const;
  const ratio = (value: number | null, numerator: number, denominator: number) => denominator === 0 ? value === null
    : value !== null && Math.abs(value - numerator / denominator) <= 1e-9 * Math.max(1, value);
  const consistent = (row: z.infer<typeof metrics>) =>
    row.impression_users <= row.identified_impressions && row.identified_impressions <= row.impressions
    && (row.impression_users > 0 || row.identified_impressions === 0)
    && row.click_users <= row.clicks
    && (row.closed_shows > 0 || row.total_visible_duration_ms === 0)
    && ratio(row.ctr, row.clicks, row.impressions)
    && ratio(row.avg_impressions_per_user, row.identified_impressions, row.impression_users)
    && ratio(row.avg_visible_duration_ms, row.total_visible_duration_ms, row.closed_shows);
  // UVs are distinct across the whole range; they must not be required to equal daily sums.
  const validAudience = (["impression_users", "click_users"] as const).every((key) =>
    result.summary[key] >= Math.max(0, ...result.daily.map((row) => row[key]))
    && result.summary[key] <= result.daily.reduce((sum, row) => sum + row[key], 0));
  if (additive.some((key) => result.daily.reduce((sum, row) => sum + row[key], 0) !== result.summary[key])
      || !validAudience || !consistent(result.summary) || result.daily.some((row) => !consistent(row))) {
    ctx.addIssue({ code: "custom", message: "统计指标不一致" });
  }
});
export type PlacementMetrics = z.infer<typeof placementMetricsSchema>;
export type PlacementMetricsQuery = MetricsRange & { app_id: string; ads_app_id: string; placement_id: string };
export interface EventAnalyticsRpc { queryPlacementMetrics(query: PlacementMetricsQuery): Promise<unknown> }
export const metricsRpcResponseSchema = z.discriminatedUnion("success", [
  z.object({ code: z.literal("OK"), success: z.literal(true), message: z.string(), result: placementMetricsSchema }),
  z.object({ code: z.string().regex(/^[AB]\d{2}-\d{3}$/), success: z.literal(false), message: z.string(), result: z.object({ details: z.unknown().optional() }) }),
]);
