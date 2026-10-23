import { useEffect, useReducer } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Campaign, Placement } from "../../../../src/features/ads/schema";
import { adStatus, adStatuses, adWindow } from "./presentation";
import { time } from "./shared";

export function AdStatusBadge({ item, campaign }: { item: Campaign | Placement; campaign?: Campaign }) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const now = Date.now();
  const { startsAt, endsAt } = item;
  const campaignStartsAt = campaign?.startsAt;
  const campaignEndsAt = campaign?.endsAt;
  useEffect(() => {
    const next = Math.min(...[startsAt, endsAt, campaignStartsAt, campaignEndsAt]
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value))
      .filter((value) => value > now));
    if (!Number.isFinite(next)) return;
    // Refresh at schedule boundaries without refetching list data.
    const timer = window.setTimeout(refresh, Math.min(next - now, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [startsAt, endsAt, campaignStartsAt, campaignEndsAt, now]);
  const key = adStatus(item, now, campaign);
  const status = adStatuses[key];
  if (key !== "active") return <Badge variant={status.variant}>{status.label}</Badge>;
  const period = adWindow(item, campaign);
  const format = (value: number) => time(Number.isFinite(value) ? new Date(value).toISOString() : null);
  return <TooltipProvider><Tooltip>
    <TooltipTrigger asChild>
      <Badge variant={status.variant} tabIndex={0} className="cursor-help">{status.label}</Badge>
    </TooltipTrigger>
    <TooltipContent sideOffset={6} className="space-y-1">
      <p className="font-medium">进行时间（上海时间）</p>
      <p>开始：{format(period.startsAt)}</p>
      <p>结束：{format(period.endsAt)}</p>
    </TooltipContent>
  </Tooltip></TooltipProvider>;
}
