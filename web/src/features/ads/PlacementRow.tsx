import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  campaignSchema, creativeSchema, slotSchema, type Placement,
} from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { adBase, adKey, pagePath, time } from "./shared";
import { AdStatusBadge } from "./AdStatusBadge";
import { PlacementActions } from "./PlacementActions";

function Cover({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
    {url && !failed
      ? <img src={url} alt={`${name}封面`} loading="lazy" decoding="async" className="size-full object-contain" onError={() => setFailed(true)} />
      : <span className="text-xs text-muted-foreground">暂无封面</span>}
  </div>;
}

export function PlacementRow({ placement, disabled }: { placement: Placement; disabled: boolean }) {
  const [creative, slot, campaign] = useQueries({ queries: [
    {
      queryKey: adKey(null, "creatives", "detail", placement.creativeId),
      queryFn: ({ signal }) => platformClient(`/ads/creatives/${encodeURIComponent(placement.creativeId)}`, creativeSchema, { signal }),
    },
    {
      queryKey: adKey(placement.appId, "slots", "detail", placement.slotKey),
      queryFn: ({ signal }) => platformClient(`${adBase(placement.appId, "slots")}/${encodeURIComponent(placement.slotKey)}`, slotSchema, { signal }),
    },
    {
      queryKey: adKey(null, "campaigns", "detail", placement.campaignId),
      queryFn: ({ signal }) => platformClient(`/ads/campaigns/${encodeURIComponent(placement.campaignId)}`, campaignSchema, { signal }),
    },
  ] });
  const imageUrl = creative.data?.published?.content.imageUrl ?? null;
  const failed = creative.isError || slot.isError || campaign.isError;
  return <tr className="border-t">
    <td className="p-3">
      <Link className="group flex min-w-56 max-w-md items-center gap-3" to={`${pagePath(placement.appId, "placements")}/${encodeURIComponent(placement.id)}`}>
        <Cover key={imageUrl} url={imageUrl} name={creative.data?.name ?? "素材"} />
        <div className="min-w-0 space-y-1">
          <p className="break-words font-medium underline-offset-4 group-hover:underline">{slot.data?.name ?? (slot.isError ? "广告位信息不可用" : "加载广告位…")}</p>
          <p className="break-words text-xs text-muted-foreground">{creative.data?.name ?? (creative.isPending ? "加载素材…" : "素材信息不可用")}</p>
        </div>
      </Link>
      {failed && <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-destructive" onClick={() => {
        if (creative.isError) void creative.refetch();
        if (slot.isError) void slot.refetch();
        if (campaign.isError) void campaign.refetch();
      }}>关联信息加载失败，重试</Button>}
    </td>
    <td className="p-3">
      {!placement.enabled || campaign.data
        ? <AdStatusBadge item={placement} campaign={campaign.data} />
        : <span className="text-xs text-muted-foreground">{campaign.isError ? "状态暂不可用" : "加载状态…"}</span>}
    </td>
    <td className="whitespace-nowrap p-3">优先级 {placement.priority}</td>
    <td className="whitespace-nowrap p-3">{time(placement.updatedAt)}</td>
    <td className="p-3"><PlacementActions placement={placement} disabled={disabled} /></td>
  </tr>;
}
