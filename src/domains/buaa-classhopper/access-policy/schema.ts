import { z } from "zod";
import { membersSchema, segmentIdsSchema } from "../../../features/segments/schema";

export const policyConfigSchema = z.object({ revision: z.number().int().positive(), segmentIds: segmentIdsSchema }).strict();
export const policyUpdateSchema = policyConfigSchema;
export const accessPolicySchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string(),
  studentIds: membersSchema.shape.student_id,
  names: membersSchema.shape.student_name,
}).strict();
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
