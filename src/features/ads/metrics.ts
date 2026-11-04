import { z } from "zod";
import { ApiError } from "../../http/errors";
import { metricsRpcResponseSchema, type EventAnalyticsRpc, type MetricsRange } from "./metrics-schema";

const appIds = z.record(z.string(), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/));

/** Read-through only: no persisted copies, retries or background synchronization. */
export async function queryPlacementMetrics(env: Pick<Env, "EVENT_ANALYTICS" | "EVENT_ANALYTICS_APP_IDS">,
  appId: string, placementId: string, range: MetricsRange) {
  let mapping: z.infer<typeof appIds>;
  try { mapping = appIds.parse(typeof env.EVENT_ANALYTICS_APP_IDS === "string"
    ? JSON.parse(env.EVENT_ANALYTICS_APP_IDS) : env.EVENT_ANALYTICS_APP_IDS); }
  catch { throw new ApiError("广告统计尚未配置", 503); }
  const analyticsApp = mapping[appId];
  if (!env.EVENT_ANALYTICS || !analyticsApp) throw new ApiError("广告统计尚未配置", 503);
  // Wrangler generates the external service binding; this repository owns its RPC contract.
  const rpc = env.EVENT_ANALYTICS as typeof env.EVENT_ANALYTICS & EventAnalyticsRpc;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let upstream: unknown;
  try {
    upstream = await Promise.race([
      rpc.queryPlacementMetrics({ app_id: analyticsApp, ads_app_id: appId, placement_id: placementId, ...range }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 10_000); }),
    ]);
  } catch { throw new ApiError("广告统计暂不可用，请稍后重试", 502); }
  finally { clearTimeout(timer); }
  const parsed = metricsRpcResponseSchema.safeParse(upstream);
  if (!parsed.success) throw new ApiError("广告统计返回了无效数据", 502);
  if (!parsed.data.success) {
    if (parsed.data.code === "A01-002") throw new ApiError("广告统计的采集应用尚未配置", 503);
    if (parsed.data.code === "A03-007") throw new ApiError("请选择最近 90 天内的日期范围", 400);
    throw new ApiError("广告统计暂不可用，请稍后重试", 502);
  }
  const result = parsed.data.result;
  if (result.app_id !== analyticsApp || result.ads_app_id !== appId || result.placement_id !== placementId
      || result.from_day !== range.from_day || result.to_day !== range.to_day)
    throw new ApiError("广告统计返回了不匹配的数据", 502);
  return result;
}
