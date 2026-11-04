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
const metrics = z.object({ impressions: count, clicks: count, ctr: z.number().finite().nonnegative().nullable() });
export const placementMetricsSchema = z.object({
  app_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), ads_app_id: id, placement_id: id,
  from_day: daySchema, to_day: daySchema,
  summary: metrics,
  daily: z.array(metrics.extend({ day: daySchema })).max(90),
  coverage: z.object({
    source: z.literal("durable_object"), time_basis: z.literal("received_at_ms"), timezone: z.literal("Asia/Shanghai"),
    retention_days: z.literal(90), stats_started_at_ms: count, available_from_day: daySchema,
    complete_from_day: daySchema, ongoing: z.boolean(), is_complete: z.boolean(),
  }),
}).superRefine((result, ctx) => {
  const days = (dayStart(result.to_day) - dayStart(result.from_day)) / 86_400_000;
  if (days < 1 || days > 90 || result.daily.length !== days
      || result.daily.some((row, i) => row.day !== addDays(result.from_day, i))) {
    ctx.addIssue({ code: "custom", message: "统计日期不完整" });
  }
  const totals = result.daily.reduce((total, row) => ({
    impressions: total.impressions + row.impressions, clicks: total.clicks + row.clicks,
  }), { impressions: 0, clicks: 0 });
  const correctRate = (row: z.infer<typeof metrics>) => row.impressions === 0 ? row.ctr === null
    : row.ctr !== null && Math.abs(row.ctr - row.clicks / row.impressions) < 1e-9;
  if (totals.impressions !== result.summary.impressions || totals.clicks !== result.summary.clicks
      || !correctRate(result.summary) || result.daily.some((row) => !correctRate(row))) {
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
