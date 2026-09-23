import { z } from "zod";

export const MAX_CONTENT_BYTES = 256 * 1024;
const title = z.string().trim().min(1, "标题不能为空").max(200, "标题最多 200 字符");
const content = z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= MAX_CONTENT_BYTES,
  "正文不能超过 256 KiB",
);
export const statusSchema = z.enum(["draft", "published", "unpublished"]);
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const createSchema = z.object({ title, content: content.default(""), isPinned: z.boolean().default(false) }).strict();
export const patchSchema = z.object({
  revision: z.number().int().positive(), title: title.optional(), content: content.optional(), isPinned: z.boolean().optional(),
}).strict().refine((value) => value.title !== undefined || value.content !== undefined || value.isPinned !== undefined, "至少修改一个字段");
const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000));
export const paginationSchema = z.object({
  page: pageNumber.default(1),
  pageSize: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).default(20),
});
export const adminQuerySchema = paginationSchema.extend({ status: statusSchema.optional() });
export const announcementSchema = z.object({
  id: z.string(), title: z.string(), content: z.string(), isPinned: z.boolean(),
  publishedAt: z.string().nullable(), status: statusSchema, revision: z.number().int().positive(),
  createdAt: z.string(), updatedAt: z.string(),
});
export const announcementPageSchema = z.object({
  items: z.array(announcementSchema), page: z.number(), pageSize: z.number(), total: z.number(),
});
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementPage = z.infer<typeof announcementPageSchema>;
export type CreateAnnouncement = z.infer<typeof createSchema>;
export type PatchAnnouncement = z.infer<typeof patchSchema>;
export type ListQuery = z.infer<typeof adminQuerySchema>;
