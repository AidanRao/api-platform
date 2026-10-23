import { z } from "zod";
import { BUSINESS_KEY_PATTERN } from "../../infrastructure/business-key";

const name = z.string().trim().min(1, "名称不能为空").max(200);
const id = z.string().min(1).max(100);
const timestamp = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const schedule = {
  startsAt: timestamp.nullable().default(null),
  endsAt: timestamp.nullable().default(null),
};
export const revisionSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const formatSchema = z.enum(["banner", "carousel", "card", "splash"]);
export const creativeTypeSchema = z.enum(["image", "card"]);
export const slotKeySchema = z
  .string()
  .regex(BUSINESS_KEY_PATTERN, "请使用小写字母或数字，可用短横线和下划线分隔")
  .max(100)
  .refine((v) => v !== "new", "new 是管理页面保留标识");
export const targetUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (
      value !== value.trim() ||
      /[\u0000-\u0020\u007f-\u009f]/.test(value) ||
      !/^[a-z][a-z0-9+.-]*:/i.test(value)
    )
      return false;
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !["javascript:", "vbscript:", "data:", "file:", "blob:"].includes(
          url.protocol,
        )
      );
    } catch {
      return false;
    }
  }, "请输入合法的 HTTP、HTTPS 或 App 深链接，不能包含凭据或危险协议")
  .nullable();
export const contentSchema = z
  .object({
    imageUrl: z.string().max(2048).url().nullable().default(null),
    title: z.string().trim().max(200).default(""),
    description: z.string().trim().max(2000).default(""),
    buttonText: z.string().trim().max(50).default(""),
  })
  .strict();
export const campaignCreateSchema = z
  .object({
    name,
    notes: z.string().trim().max(2000).default(""),
    enabled: z.boolean().default(false),
    ...schedule,
  })
  .strict();
export const creativeCreateSchema = z
  .object({
    name,
    type: creativeTypeSchema,
    draft: contentSchema.default({
      imageUrl: null,
      title: "",
      description: "",
      buttonText: "",
    }),
  })
  .strict();
export const slotCreateSchema = z
  .object({
    slotKey: slotKeySchema,
    name,
    format: formatSchema,
    maxItems: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export const placementCreateSchema = z
  .object({
    campaignId: id,
    slotKey: slotKeySchema,
    creativeId: id,
    targetUrl: targetUrlSchema.default(null),
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    enabled: z.boolean().default(false),
    ...schedule,
  })
  .strict();
const changes = (value: object) =>
  Object.keys(value).some((key) => key !== "revision");
// PATCH fields deliberately omit create-time defaults: omission must preserve stored values.
export const campaignPatchSchema = z
  .object({
    ...revisionSchema.shape,
    name: name.optional(),
    notes: z.string().trim().max(2000).optional(),
    enabled: z.boolean().optional(),
    startsAt: timestamp.nullable().optional(),
    endsAt: timestamp.nullable().optional(),
  })
  .strict()
  .refine(changes, "至少修改一个字段");
export const creativePatchSchema = z
  .object({
    ...revisionSchema.shape,
    name: name.optional(),
    draft: contentSchema.optional(),
  })
  .strict()
  .refine(changes, "至少修改一个字段");
export const slotPatchSchema = z
  .object({
    ...revisionSchema.shape,
    name: name.optional(),
    maxItems: z.number().int().min(1).max(10).optional(),
  })
  .strict()
  .refine(changes, "至少修改一个字段");
export const placementPatchSchema = z
  .object({
    ...revisionSchema.shape,
    campaignId: id.optional(),
    slotKey: slotKeySchema.optional(),
    creativeId: id.optional(),
    targetUrl: targetUrlSchema.optional(),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    enabled: z.boolean().optional(),
    startsAt: timestamp.nullable().optional(),
    endsAt: timestamp.nullable().optional(),
  })
  .strict()
  .refine(changes, "至少修改一个字段");
export const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  enabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  campaignId: id.optional(),
  creativeId: id.optional(),
  slotKey: slotKeySchema.optional(),
});
const metadata = {
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
};
export const campaignSchema = campaignCreateSchema.extend({ id, ...metadata });
export const versionSchema = z.object({
  creativeId: id,
  version: z.number().int().positive(),
  content: contentSchema,
  publishedAt: z.string(),
});
export const creativeSchema = creativeCreateSchema.extend({
  id,
  publishedVersion: z.number().int().positive().nullable(),
  published: versionSchema.nullable(),
  ...metadata,
});
export const slotSchema = slotCreateSchema.extend({
  appId: id,
  maxItems: z.number().int(),
  ...metadata,
});
export const placementSchema = placementCreateSchema.extend({
  id,
  appId: id,
  ...metadata,
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  });
export type Campaign = z.infer<typeof campaignSchema>;
export type Creative = z.infer<typeof creativeSchema>;
export type CreativeVersion = z.infer<typeof versionSchema>;
export type AdSlot = z.infer<typeof slotSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type AdContent = z.infer<typeof contentSchema>;
export type AdQuery = z.infer<typeof querySchema>;
export type CampaignInput = z.infer<typeof campaignCreateSchema>;
export type CreativeInput = z.infer<typeof creativeCreateSchema>;
export type SlotInput = z.infer<typeof slotCreateSchema>;
export type PlacementInput = z.infer<typeof placementCreateSchema>;
