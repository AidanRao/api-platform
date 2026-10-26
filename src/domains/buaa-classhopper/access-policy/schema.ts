import { z } from "zod";
import { membersSchema, segmentIdsSchema } from "../../../features/segments/schema";
import { versionNumberSchema } from "../../../features/versions/schema";

export const policyResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("segments"), segmentIds: segmentIdsSchema }).strict(),
  z.object({ type: z.literal("empty") }).strict(),
  z.object({ type: z.literal("unavailable") }).strict(),
]);
export const policyConfigSchema = z.object({
  revision: z.number().int().positive(),
  rules: z.array(z.object({ version: versionNumberSchema, result: policyResultSchema }).strict()),
  default: z.object({ unmatched: policyResultSchema, invalidVersion: policyResultSchema }).strict(),
}).strict().superRefine((config, ctx) => {
  const versions = new Set<string>();
  config.rules.forEach((rule, index) => {
    if (versions.has(rule.version)) ctx.addIssue({ code: "custom", path: ["rules", index, "version"], message: "版本号不能重复" });
    versions.add(rule.version);
  });
});
export const policyUpdateSchema = policyConfigSchema;
export const accessPolicySchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string(),
  studentIds: membersSchema.shape.student_id,
  names: membersSchema.shape.student_name,
}).strict();
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyResult = z.infer<typeof policyResultSchema>;
export type AccessPolicy = z.infer<typeof accessPolicySchema>;

export const emptyPolicyConfig = (): PolicyConfig => ({ revision: 1, rules: [], default: {
  unmatched: { type: "empty" },
  invalidVersion: { type: "empty" },
} });
