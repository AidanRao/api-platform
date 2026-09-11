import { z } from "zod";

const MAX_LIST_ITEMS = 500;
const REVISION_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{3,})$/;

function uniqueStringList(field: string, maxItemLength: number) {
  return z
    .array(
      z
        .string()
        .trim()
        .min(1, `${field} 项不能为空`)
        .max(maxItemLength, `${field} 项不能超过 ${maxItemLength} 个字符`),
    )
    .max(MAX_LIST_ITEMS, `${field} 最多包含 ${MAX_LIST_ITEMS} 项`)
    .superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item)) {
          context.addIssue({
            code: "custom",
            message: `${field} 不能包含重复项：${item}`,
            path: [index],
          });
        }
        seen.add(item);
      });
    });
}

export const revisionSchema = z
  .string()
  .trim()
  .max(64, "revision 不能超过 64 个字符")
  .regex(REVISION_PATTERN, "revision 必须使用 YYYY-MM-DD-NNN 格式")
  .refine(
    (revision) => parseRevision(revision) !== null,
    "revision 必须包含有效日期和正整数版本",
  );

export const accessPolicySchema = z.strictObject({
  schemaVersion: z.literal(1, { error: "schemaVersion 只能为 1" }),
  revision: revisionSchema,
  studentIds: uniqueStringList("studentIds", 64),
  names: uniqueStringList("names", 100),
});

const patchGroupSchema = z.strictObject({
  studentIds: uniqueStringList("studentIds", 64).optional(),
  names: uniqueStringList("names", 100).optional(),
});

export const accessPolicyPatchSchema = z
  .strictObject({
    baseRevision: revisionSchema,
    add: patchGroupSchema.optional(),
    remove: patchGroupSchema.optional(),
  })
  .superRefine((patch, context) => {
    const operationLists = [
      patch.add?.studentIds,
      patch.add?.names,
      patch.remove?.studentIds,
      patch.remove?.names,
    ];
    if (
      !operationLists.some(
        (items) => items !== undefined && items.length > 0,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "add 或 remove 至少需要包含一个非空数组",
      });
    }

    addOverlapIssue(
      patch.add?.studentIds,
      patch.remove?.studentIds,
      "studentIds",
      context,
    );
    addOverlapIssue(
      patch.add?.names,
      patch.remove?.names,
      "names",
      context,
    );
  });

export type AccessPolicy = z.infer<typeof accessPolicySchema>;
export type AccessPolicyPatch = z.infer<typeof accessPolicyPatchSchema>;

export interface ParsedRevision {
  date: string;
  version: bigint;
}

export function parseRevision(revision: string): ParsedRevision | null {
  const match = REVISION_PATTERN.exec(revision);
  if (match === null) {
    return null;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const versionText = match[4];
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    versionText === undefined
  ) {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const version = BigInt(versionText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    version < 1n ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { date: `${yearText}-${monthText}-${dayText}`, version };
}

export function formatAccessPolicyIssues(
  issues: readonly z.core.$ZodIssue[],
): string[] {
  return issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}

function addOverlapIssue(
  additions: string[] | undefined,
  removals: string[] | undefined,
  field: "studentIds" | "names",
  context: z.RefinementCtx,
): void {
  if (additions === undefined || removals === undefined) {
    return;
  }

  const removalSet = new Set(removals);
  for (const item of additions) {
    if (removalSet.has(item)) {
      context.addIssue({
        code: "custom",
        message: `${field} 不能在同一请求中同时增加和删除：${item}`,
        path: ["add", field],
      });
    }
  }
}
