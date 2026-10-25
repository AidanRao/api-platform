import { z } from "zod";
import { platformClient, jsonRequest } from "../../platform/api";
import { segmentSchema, segmentPageSchema, type SegmentInput, type SegmentSummary } from "../../../../src/features/segments/schema";

export const segmentKey = ["platform", "segments"] as const;
export const segmentClient = {
  list: (page = 1, search = "", signal?: AbortSignal) => platformClient(`/segments?${new URLSearchParams({ page: String(page), pageSize: "20", search })}`, segmentPageSchema, { signal }),
  options: async (signal?: AbortSignal): Promise<SegmentSummary[]> => {
    const items: SegmentSummary[] = [];
    for (let page = 1; ; page++) {
      const result = await platformClient(`/segments?${new URLSearchParams({ page: String(page), pageSize: "100" })}`, segmentPageSchema, { signal });
      items.push(...result.items);
      if (items.length >= result.total || result.items.length === 0) return items;
    }
  },
  get: (id: string, signal?: AbortSignal) => platformClient(`/segments/${encodeURIComponent(id)}`, segmentSchema, { signal }),
  summary: async (id: string, signal?: AbortSignal): Promise<SegmentSummary> => {
    const page = await segmentClient.list(1, id, signal), value = page.items.find((s) => s.id === id);
    if (!value) throw new Error("人群不存在");
    return value;
  },
  create: (input: SegmentInput) => platformClient("/segments", segmentSchema, jsonRequest("POST", input)),
  update: (id: string, revision: number, input: SegmentInput) => platformClient(`/segments/${encodeURIComponent(id)}`, segmentSchema, jsonRequest("PUT", { ...input, revision })),
  delete: (id: string, revision: number) => platformClient(`/segments/${encodeURIComponent(id)}`, z.null(), jsonRequest("DELETE", { revision })),
};
