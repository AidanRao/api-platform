import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useApplication } from "../../platform/AppContext";
import { platformClient } from "../../platform/api";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  campaignSchema,
  creativeSchema,
  slotSchema,
  placementSchema,
  pageSchema,
} from "../../../../src/features/ads/schema";
import { adBase, adKey, formatNames, pagePath, time } from "./shared";
import { PlacementActions } from "./PlacementActions";
import { SegmentedChoice } from "@/components/ui/segmented-choice";
const labels = {
  campaigns: "广告活动",
  creatives: "共享素材",
  slots: "广告位管理",
  placements: "广告投放",
};
type Resource = keyof typeof labels;
async function list(
  scope: string | null,
  resource: Resource,
  query: string,
  signal: AbortSignal,
) {
  const url = `${adBase(scope, resource)}?${query}`;
  switch (resource) {
    case "campaigns":
      return platformClient(url, pageSchema(campaignSchema), { signal });
    case "creatives":
      return platformClient(url, pageSchema(creativeSchema), { signal });
    case "slots":
      return platformClient(url, pageSchema(slotSchema), { signal });
    case "placements":
      return platformClient(url, pageSchema(placementSchema), { signal });
  }
}
function AdsList({
  scope,
  resource,
}: {
  scope: string | null;
  resource: Resource;
}) {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? 1),
    page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  query.set("pageSize", "20");
  const data = useQuery({
    queryKey: adKey(scope, resource, "list", query.toString()),
    queryFn: ({ signal }) => list(scope, resource, query.toString(), signal),
  });
  const update = (key: string, value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      value ? next.set(key, value) : next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    });
  const path = pagePath(scope, resource);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{labels[resource]}</h1>
        <Button asChild>
          <Link to={`${path}/new`}>
            新建
            {resource === "creatives"
              ? "素材"
              : resource === "campaigns"
                ? "活动"
                : resource === "slots"
                  ? "广告位"
                  : "投放"}
          </Link>
        </Button>
      </header>
      <div className="flex flex-wrap gap-3">
        {resource !== "creatives" && (
          <SegmentedChoice
            label="启用状态"
            hideLabel
            value={params.get("enabled") ?? ""}
            options={[
              { value: "", label: "全部状态" },
              { value: "true", label: "启用" },
              { value: "false", label: "停用" },
            ]}
            onChange={(enabled) => update("enabled", enabled)}
          />
        )}
        {resource === "placements" &&
          [
            ["campaignId", "活动 ID"],
            ["creativeId", "素材 ID"],
            ["slotKey", "广告位标识"],
          ].map(([key, label]) => (
            <Input
              key={key}
              className="w-56"
              aria-label={label}
              placeholder={label}
              value={params.get(key!) ?? ""}
              onChange={(e) => update(key!, e.target.value)}
            />
          ))}
      </div>
      {data.isPending ? (
        <Loading />
      ) : data.isError ? (
        <>
          <ErrorNotice error={data.error} />
          <Button onClick={() => void data.refetch()}>重新加载</Button>
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="p-3">
                    {resource === "placements" ? "投放" : "名称"}
                  </th>
                  <th className="p-3">状态</th>
                  <th className="p-3">
                    {resource === "creatives" ? "发布版本" : "配置"}
                  </th>
                  <th className="p-3">更新时间（上海）</th>
                  {resource === "placements" && <th className="p-3">操作</th>}
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((item) => {
                  const id = "id" in item ? item.id : item.slotKey;
                  return (
                    <tr key={id} className="border-t">
                      <td className="p-3">
                        <Link
                          className="font-medium underline underline-offset-4"
                          to={`${path}/${encodeURIComponent(id)}`}
                        >
                          {"name" in item
                            ? item.name
                            : `${item.slotKey} · ${item.id}`}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {id}
                        </div>
                      </td>
                      <td className="p-3">
                        {"enabled" in item
                          ? item.enabled
                            ? "启用"
                            : "停用"
                          : item.publishedVersion === null
                            ? "未发布"
                            : JSON.stringify(item.draft) ===
                                JSON.stringify(item.published?.content)
                              ? "已发布"
                              : "有未发布更改"}
                      </td>
                      <td className="p-3">
                        {"publishedVersion" in item
                          ? (item.publishedVersion ?? "—")
                          : "format" in item
                            ? `${formatNames[item.format]} · ${item.maxItems} 条`
                            : "priority" in item
                              ? `优先级 ${item.priority}`
                              : `${time(item.startsAt)} → ${time(item.endsAt)}`}
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {time(item.updatedAt)}
                      </td>
                      {resource === "placements" && "creativeId" in item && (
                        <td className="p-3">
                          <PlacementActions
                            key={`${scope}/${item.id}`}
                            placement={item}
                            disabled={data.isFetching}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!data.data.items.length && (
                  <tr>
                    <td
                      colSpan={resource === "placements" ? 5 : 4}
                      className="p-8 text-center text-muted-foreground"
                    >
                      暂无记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              共 {data.data.total} 条 · 第 {page} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => update("page", String(page - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={page * 20 >= data.data.total}
                onClick={() => update("page", String(page + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
export function CampaignsList() {
  return <AdsList scope={null} resource="campaigns" />;
}
export function CreativesList() {
  return <AdsList scope={null} resource="creatives" />;
}
export function SlotsList() {
  const app = useApplication();
  return <AdsList scope={app.id} resource="slots" />;
}
export function PlacementsList() {
  const app = useApplication();
  return <AdsList scope={app.id} resource="placements" />;
}
