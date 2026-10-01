import { z } from "zod";
import { tagListSchema, announcementPageSchema, announcementSchema, type CreateAnnouncement, type PatchAnnouncement } from "../../../../src/features/announcements/schema";
import { createAdminClient, jsonRequest } from "../../platform/api";

/** A capability-specific client receives app identity from the platform shell. */
export function createAnnouncementClient(appId: string) {
  const request = createAdminClient(appId);
  const base = "/announcement";
  return {
    tags: (status = "", signal?: AbortSignal) => request(`${base}/tags${status ? `?status=${encodeURIComponent(status)}` : ""}`, tagListSchema, { signal }),
    list: (page: number, status: string, signal?: AbortSignal, tag = "") => request(`${base}?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ""}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`, announcementPageSchema, { signal }),
    get: (id: string) => request(`${base}/${encodeURIComponent(id)}`, announcementSchema),
    create: (input: CreateAnnouncement) => request(base, announcementSchema, jsonRequest("POST", input)),
    patch: (id: string, input: PatchAnnouncement) => request(`${base}/${encodeURIComponent(id)}`, announcementSchema, jsonRequest("PATCH", input)),
    changeStatus: (id: string, revision: number, action: "publish" | "unpublish") => request(`${base}/${encodeURIComponent(id)}/${action}`, announcementSchema, jsonRequest("POST", { revision })),
    delete: (id: string, revision: number) => request(`${base}/${encodeURIComponent(id)}`, z.null(), jsonRequest("DELETE", { revision })),
  };
}
