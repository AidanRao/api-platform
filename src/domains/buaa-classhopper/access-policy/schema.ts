import { z } from "zod";
import { membersSchema, segmentIdsSchema } from "../../../features/segments/schema";

export const policyConfigSchema = z.object({ revision: z.number().int().positive(), segmentIds: segmentIdsSchema }).strict();
export const policyUpdateSchema = policyConfigSchema;
export const accessPolicySchema = z.object({ revision: z.string(), members: membersSchema.pick({ student_name: true, student_id: true }).strict() }).strict();
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
