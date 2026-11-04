import { useEffect, useRef, useState } from "react";
import { addDays, daySchema, placementMetricsSchema, shanghaiDay, validMetricsRange,
  type PlacementMetrics } from "../../../../src/features/ads/metrics-schema";
import { platformClient } from "../../platform/api";
import { adBase } from "./shared";

export type DateSelection = { from: string; through: string };
export const recentDays = (days: number): DateSelection => {
  const through = shanghaiDay();
  return { from: addDays(through, -(days - 1)), through };
};

/** Deliberately independent of QueryClient invalidation, focus and reconnect events. */
export function usePlacementMetrics(appId: string, placementId: string | null) {
  const [dates, setDates] = useState(() => recentDays(7));
  const [data, setData] = useState<PlacementMetrics | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const firstVisit = useRef(false);
  const active = useRef<AbortController | null>(null);
  const lastAttempt = useRef(dates);
  useEffect(() => () => { active.current?.abort(); }, []);

  async function load(selection: DateSelection) {
    if (!placementId || active.current) return;
    if (!daySchema.safeParse(selection.from).success || !daySchema.safeParse(selection.through).success) {
      setError(new Error("请选择有效日期")); return;
    }
    const range = { from_day: selection.from, to_day: addDays(selection.through, 1) };
    if (!validMetricsRange(range)) { setError(new Error("请选择最近 90 天内的日期范围")); return; }
    lastAttempt.current = { ...selection };
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError(null); setData(null);
    try {
      const result = await platformClient(
        `${adBase(appId, "placements")}/${encodeURIComponent(placementId)}/metrics?${new URLSearchParams(range)}`,
        placementMetricsSchema, { signal: controller.signal },
      );
      if (!controller.signal.aborted) setData(result);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught);
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return {
    dates, setDates, data, error, pending,
    open: () => { if (!firstVisit.current && placementId) { firstVisit.current = true; void load(dates); } },
    query: () => void load(dates),
    retry: () => void load(lastAttempt.current),
  };
}
