import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, shanghaiDay, type PlacementMetrics } from "../../../../src/features/ads/metrics-schema";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { recentDays, type usePlacementMetrics } from "./usePlacementMetrics";

const count = (value: number) => value.toLocaleString("zh-CN");
const rate = (value: number | null) => value === null ? "—" : `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;

function Trend({ daily, metric, label }: { daily: PlacementMetrics["daily"]; metric: "impressions" | "clicks"; label: string }) {
  const title = useId();
  const max = Math.max(1, ...daily.map((row) => row[metric]));
  const points = daily.map((row, i) => `${(daily.length === 1 ? 50 : i / (daily.length - 1) * 100).toFixed(2)},${(96 - row[metric] / max * 88).toFixed(2)}`);
  return <figure className="min-w-0 space-y-3" aria-labelledby={title}>
    <figcaption id={title} className="text-sm font-medium">{label}</figcaption>
    <div className="flex min-w-0 gap-3">
      <div aria-hidden="true" className="flex shrink-0 flex-col justify-between pb-1 text-xs tabular-nums text-muted-foreground"><span>{count(max)}</span><span>0</span></div>
      <svg role="img" aria-label={`每日${label}`} viewBox="0 0 100 100" preserveAspectRatio="none" className="h-36 min-w-0 flex-1 overflow-visible">
        <title>每日{label}，精确数值见每日明细</title>
        <path d="M0 8H100 M0 52H100 M0 96H100" fill="none" stroke="var(--border)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        <polyline points={points.join(" ")} fill="none" stroke="var(--foreground)" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {daily.length === 1 && <circle cx="50" cy={96 - daily[0]![metric] / max * 88} r="0.8" fill="var(--foreground)" />}
      </svg>
    </div>
    <div aria-hidden="true" className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground"><span>{daily[0]?.day}</span>{daily.length > 1 && <span>{daily.at(-1)?.day}</span>}</div>
  </figure>;
}

export function PlacementMetricsPanel({ metrics }: { metrics: ReturnType<typeof usePlacementMetrics> }) {
  const { dates, setDates, data, pending, error } = metrics;
  const today = shanghaiDay(), oldest = addDays(today, -89);
  return <div className="max-w-4xl space-y-6">
    <form onSubmit={(event) => { event.preventDefault(); metrics.query(); }}>
      <fieldset disabled={pending} className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex w-full gap-2 sm:w-auto" role="group" aria-label="统计日期预设">
          {[7, 30, 90].map((days) => {
            const range = recentDays(days);
            const selected = dates.from === range.from && dates.through === range.through;
            return <Button key={days} type="button" variant={selected ? "default" : "outline"} aria-pressed={selected} onClick={() => setDates(range)}>近 {days} 天</Button>;
          })}
        </div>
        <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto"><Label htmlFor="metrics-from" className="shrink-0">开始日期</Label><Input id="metrics-from" className="min-w-0 flex-1 sm:w-36 sm:flex-none" type="date" required min={oldest} max={dates.through || today} value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></div>
        <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto"><Label htmlFor="metrics-through" className="shrink-0">结束日期</Label><Input id="metrics-through" className="min-w-0 flex-1 sm:w-36 sm:flex-none" type="date" required min={dates.from || oldest} max={today} value={dates.through} onChange={(e) => setDates({ ...dates, through: e.target.value })} /></div>
        <Button type="submit" className="w-full sm:w-auto">{pending ? "查询中…" : "查询"}</Button>
      </fieldset>
    </form>
    {pending && <Loading />}
    {error !== null && <div className="space-y-3"><ErrorNotice error={error} /><Button type="button" variant="outline" onClick={metrics.retry} disabled={pending}>重试</Button></div>}
    {data && <>
      <p className="text-xs text-muted-foreground" aria-live="polite">统计范围：{data.from_day} 至 {addDays(data.to_day, -1)}（上海时间）</p>
      <dl className="grid grid-cols-1 gap-4 border-y py-5 sm:grid-cols-3 sm:gap-6">
        {[["曝光量", count(data.summary.impressions)], ["点击数", count(data.summary.clicks)], ["点击率", rate(data.summary.ctr)]].map(([label, value]) => <div key={label} className="space-y-1"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <div className="grid min-w-0 grid-cols-1 gap-8 sm:grid-cols-2"><Trend daily={data.daily} metric="impressions" label="曝光趋势" /><Trend daily={data.daily} metric="clicks" label="点击趋势" /></div>
      <table className="w-full text-sm tabular-nums">
        <caption className="pb-3 text-left font-medium">每日明细</caption>
        <thead><tr className="border-b text-xs text-muted-foreground">{["日期", "曝光量", "点击数", "点击率"].map((label, i) => <th key={label} className={`py-3 font-medium ${i ? "pl-3 text-right" : "text-left"}`}>{label}</th>)}</tr></thead>
        <tbody>{data.daily.map((row) => <tr key={row.day} className="border-b"><th scope="row" className="whitespace-nowrap py-3 text-left font-normal">{row.day}</th><td className="py-3 pl-3 text-right">{count(row.impressions)}</td><td className="py-3 pl-3 text-right">{count(row.clicks)}</td><td className="py-3 pl-3 text-right">{rate(row.ctr)}</td></tr>)}</tbody>
      </table>
    </>}
  </div>;
}
