import { z } from "zod";
import { createAdminClient, jsonRequest } from "../../platform/api";
import { settingsSchema, versionPageSchema, versionSchema, type CreateVersion, type VersionFields } from "../../../../src/features/versions/schema";

export function createVersionClient(appId: string) {
  const request = createAdminClient(appId), base = "/versions";
  return {
    list: (page = 1, pageSize = 20, signal?: AbortSignal) => request(`${base}?page=${page}&pageSize=${pageSize}`, versionPageSchema, { signal }),
    get: (version: string) => request(`${base}/${encodeURIComponent(version)}`, versionSchema),
    create: (input: CreateVersion) => request(base, versionSchema, jsonRequest("POST", input)),
    update: (version: string, revision: number, fields: VersionFields) => request(`${base}/${encodeURIComponent(version)}`, versionSchema, jsonRequest("PATCH", { ...fields, revision })),
    delete: (version: string, revision: number) => request(`${base}/${encodeURIComponent(version)}`, z.null(), jsonRequest("DELETE", { revision })),
    settings: () => request(`${base}/latest`, settingsSchema),
    setLatest: (version: string | null, revision: number) => request(`${base}/latest`, settingsSchema, jsonRequest("PUT", { version, revision })),
  };
}
