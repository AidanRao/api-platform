import { z } from "zod";

export const MEMBER_FIELDS = ["student_name", "student_id", "sso_id"] as const;
export type MemberField = typeof MEMBER_FIELDS[number];
function values(max: number) {
  return z.array(z.string().trim().min(1).max(max).refine((v) => !/[\x00-\x1f\x7f]/.test(v), "名单项不能包含控制字符"))
    .transform((items) => [...new Set(items)].sort());
}
export const membersSchema = z.object({ student_name: values(100), student_id: values(64), sso_id: values(256) }).strict();
export const emptyMembers = (): Members => ({ student_name: [], student_id: [], sso_id: [] });
export const segmentIdSchema = z.string().regex(/^SEGM-\d{8}-[A-Z0-9]{10}$/, "Segment ID 无效");
export const segmentIdsSchema = z.array(segmentIdSchema).max(100).transform((ids) => [...new Set(ids)].sort());
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const segmentInputSchema = z.object({ name: z.string().trim().min(1, "名称不能为空").max(100), members: membersSchema }).strict();
export const segmentUpdateSchema = segmentInputSchema.extend({ revision: z.number().int().positive() }).strict();
export const segmentReferencesSchema = revisionSchema.extend({ segmentIds: segmentIdsSchema }).strict();
export const pageQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
export const segmentQuerySchema = pageQuerySchema.extend({ search: z.string().trim().max(100).optional() });
export const segmentSummarySchema = z.object({ id: segmentIdSchema, name: z.string(), revision: z.number().int().positive(), counts: z.object({ student_name: z.number().int().nonnegative(), student_id: z.number().int().nonnegative(), sso_id: z.number().int().nonnegative() }), createdAt: z.string(), updatedAt: z.string() });
export const segmentSchema = segmentSummarySchema.extend({ members: membersSchema });
export const segmentPageSchema = z.object({ items: z.array(segmentSummarySchema), page: z.number(), pageSize: z.number(), total: z.number() });
export const snapshotSchema = z.object({ schemaVersion: z.literal(1), segmentId: segmentIdSchema, members: membersSchema }).strict();
export type Members = z.infer<typeof membersSchema>;
export type SegmentIdentity = Partial<Record<MemberField, string>>;
export type SegmentInput = z.infer<typeof segmentInputSchema>;
export type SegmentSummary = z.infer<typeof segmentSummarySchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type SegmentQuery = z.infer<typeof segmentQuerySchema>;
export interface StoredSegment extends SegmentSummary { snapshotKey: string }
export interface SegmentReader { load(ids: readonly string[]): Promise<Segment[]> }

export function matchesMembers(members: Members, identity: SegmentIdentity): boolean {
  return MEMBER_FIELDS.some((field) => identity[field] !== undefined && members[field].includes(identity[field]!.trim()));
}
export function mergeMembers(segments: readonly Pick<Segment, "members">[]): Members {
  const result = emptyMembers();
  for (const field of MEMBER_FIELDS) result[field] = [...new Set(segments.flatMap((s) => s.members[field]))].sort();
  return result;
}
