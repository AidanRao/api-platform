import { z } from "zod";
import { segmentIdsSchema } from "../segments/schema";

export const versionNumberSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "版本号须为 x.x.x，且不能包含前导零")
  .refine((v) => v.split(".").every((n) => Number.isSafeInteger(Number(n))), "版本号数值过大");
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]! ? 1 : -1;
  return 0;
}
export function effectiveVersion(latest: string | null, assigned: string | null): string | null {
  return assigned && (!latest || compareVersions(assigned, latest) > 0) ? assigned : latest;
}
const releaseNotes = z.string().refine((s) => new TextEncoder().encode(s).byteLength <= 256 * 1024, "更新说明不能超过 256 KiB");
const downloadUrl = z.string().max(2048).url().refine((value) => {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !/[\x00-\x20\x7f]/.test(value);
  } catch { return false; }
}, "下载地址须为 HTTP/HTTPS 地址且不能包含凭据").nullable();
const size = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const releaseTypeSchema = z.enum(["full", "gray"]);
export const versionFieldsSchema = z.object({ releaseType: releaseTypeSchema.default("gray"), segmentIds: segmentIdsSchema.default([]), releaseNotes: releaseNotes.default(""), downloadUrl: downloadUrl.default(null), downloadSizeBytes: size.default(null) });
export const createTokenVersionSchema = versionFieldsSchema.omit({ releaseType: true }).extend({ version: versionNumberSchema }).strict();
export const createVersionSchema = versionFieldsSchema.extend({ version: versionNumberSchema }).strict()
  .refine((v) => v.releaseType === "gray" || v.segmentIds.length === 0, { message: "只有灰度版本可以配置人群", path: ["segmentIds"] });
export const patchVersionSchema = z.object({ revision: z.number().int().positive(), releaseType: releaseTypeSchema.optional(), segmentIds: segmentIdsSchema.optional(), releaseNotes: releaseNotes.optional(), downloadUrl: downloadUrl.optional(), downloadSizeBytes: size.optional() }).strict()
  .refine((v) => v.releaseType !== undefined || v.segmentIds !== undefined || v.releaseNotes !== undefined || v.downloadUrl !== undefined || v.downloadSizeBytes !== undefined, "至少修改一个字段")
  .refine((v) => v.releaseType !== "full" || !v.segmentIds?.length, { message: "只有灰度版本可以配置人群", path: ["segmentIds"] });
export const latestInputSchema = revisionSchema.extend({ version: versionNumberSchema.nullable() }).strict();
const pageNumber = z.coerce.number().int().min(1).max(1_000_000);
export const pageQuerySchema = z.object({ page: pageNumber.default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
export const versionSchema = z.object({
  version: versionNumberSchema, releaseType: releaseTypeSchema, releaseNotes: z.string(), downloadUrl: z.string().nullable(), downloadSizeBytes: size,
  revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), segmentIds: z.array(z.string()),
});
export const settingsSchema = z.object({ latestVersion: versionNumberSchema.nullable(), revision: z.number().int().positive() });
export const versionPageSchema = z.object({ items: z.array(versionSchema), page: z.number(), pageSize: z.number(), total: z.number() });
export type AppVersion = z.infer<typeof versionSchema>;
export type CreateVersion = z.infer<typeof createVersionSchema>;
export type VersionFields = z.infer<typeof versionFieldsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
