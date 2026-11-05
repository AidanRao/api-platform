import { addDays, dayStart, shanghaiDay, type PlacementMetrics, type PlacementMetricsQuery } from "../../src/features/ads/metrics-schema";

export function metricsFixture(query: PlacementMetricsQuery): PlacementMetrics {
  const daily: PlacementMetrics["daily"] = [];
  for (let day = query.from_day; day < query.to_day; day = addDays(day, 1))
    daily.push({ day, impressions: 1000, clicks: 3, ctr: .003,
      impression_users: 250, click_users: 2, identified_impressions: 1000, avg_impressions_per_user: 4,
      closed_shows: 800, total_visible_duration_ms: 2_000_000, avg_visible_duration_ms: 2500 });
  return { ...query, summary: { impressions: daily.length * 1000, clicks: daily.length * 3, ctr: .003,
      impression_users: 250, click_users: 2, identified_impressions: daily.length * 1000, avg_impressions_per_user: daily.length * 4,
      closed_shows: daily.length * 800, total_visible_duration_ms: daily.length * 2_000_000, avg_visible_duration_ms: 2500 }, daily,
    coverage: { source: "durable_object", time_basis: "received_at_ms", timezone: "Asia/Shanghai", retention_days: 90,
      stats_started_at_ms: dayStart(query.from_day), extended_stats_started_at_ms: dayStart(query.from_day), available_from_day: addDays(shanghaiDay(), -89),
      complete_from_day: query.from_day, ongoing: query.to_day > shanghaiDay(), is_complete: query.to_day <= shanghaiDay() } };
}
