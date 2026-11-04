import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { placementFiltersSchema } from "../../../../src/features/ads/schema";
import { platformClient } from "../../platform/api";
import { ErrorNotice } from "../../platform/feedback";
import { adBase, adKey } from "./shared";

export function PlacementFilters({ appId }: { appId: string }) {
  const [params, setParams] = useSearchParams();
  const filters = useQuery({
    queryKey: adKey(appId, "placements", "filters"),
    queryFn: ({ signal }) => platformClient(
      `${adBase(appId, "placements")}/filters`, placementFiltersSchema, { signal },
    ),
    staleTime: Infinity,
    refetchOnMount: "always",
  });
  const fields = [
    { key: "campaignId", label: "活动", options: filters.data?.campaigns.map((v) => ({ value: v.id, name: v.name })) },
    { key: "creativeId", label: "素材", options: filters.data?.creatives.map((v) => ({ value: v.id, name: v.name })) },
    { key: "slotKey", label: "广告位", options: filters.data?.slots.map((v) => ({ value: v.slotKey, name: v.name })) },
  ];
  return <>
    <Input
      name="id"
      aria-label="投放 ID"
      placeholder="投放 ID"
      value={params.get("id") ?? ""}
      maxLength={100}
      className="w-full text-sm shadow-none transition-none sm:w-56"
      onChange={(event) => {
        const id = event.target.value.trim();
        setParams((current) => {
          const next = new URLSearchParams(current);
          id ? next.set("id", id) : next.delete("id");
          next.delete("page");
          return next;
        }, { replace: true });
      }}
    />
    {fields.map(({ key, label, options }) => {
      const value = params.get(key) ?? "";
      return <Select
        key={key}
        value={value || "__all__"}
        disabled={filters.isPending || filters.isError}
        onValueChange={(selected) => setParams((current) => {
          const next = new URLSearchParams(current);
          selected === "__all__" ? next.delete(key) : next.set(key, selected);
          next.delete("page");
          return next;
        })}
      >
        <SelectTrigger aria-label={label} className="w-full shadow-none transition-none sm:w-48">
          <SelectValue>
            {value ? options?.find((v) => v.value === value)?.name ?? value : `全部${label}`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" className="resource-theme max-w-[calc(100vw-2rem)] shadow-none data-[state=open]:animate-none data-[state=closed]:animate-none">
          <SelectItem value="__all__">全部{label}</SelectItem>
          {options?.map((option) => <SelectItem key={option.value} value={option.value}>
            {option.name}
          </SelectItem>)}
        </SelectContent>
      </Select>;
    })}
    {filters.isError && <div className="flex w-full flex-wrap items-center gap-3">
      <ErrorNotice error={filters.error} />
      <Button variant="outline" disabled={filters.isFetching} onClick={() => void filters.refetch()}>重新加载筛选</Button>
    </div>}
  </>;
}
