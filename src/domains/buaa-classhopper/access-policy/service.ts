import {
  accessPolicySchema,
  type AccessPolicy,
  type AccessPolicyPatch,
  formatAccessPolicyIssues,
  parseRevision,
} from "./schema";
import { readAccessPolicy, writeAccessPolicy } from "./repository";

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface AccessPolicyChangeCounts {
  added: number;
  removed: number;
}

export interface AccessPolicyUpdateResult {
  policy: AccessPolicy;
  previousRevision: string;
  changed: boolean;
  changes: AccessPolicyChangeCounts;
}

export class RevisionConflictError extends Error {
  constructor(readonly currentRevision: string) {
    super("白名单版本已更新，请刷新后重试");
    this.name = "RevisionConflictError";
  }
}

export class AccessPolicyMutationError extends Error {
  constructor(readonly details: string[]) {
    super("请求数据格式错误");
    this.name = "AccessPolicyMutationError";
  }
}

export async function updateAccessPolicy(
  kv: KVNamespace,
  patch: AccessPolicyPatch,
  now: Date = new Date(),
): Promise<AccessPolicyUpdateResult | null> {
  const current = await readAccessPolicy(kv);
  if (current === null) {
    return null;
  }

  const result = applyAccessPolicyPatch(current, patch, now);
  if (result.changed) {
    await writeAccessPolicy(kv, result.policy);
  }
  return result;
}

export function applyAccessPolicyPatch(
  current: AccessPolicy,
  patch: AccessPolicyPatch,
  now: Date,
): AccessPolicyUpdateResult {
  if (patch.baseRevision !== current.revision) {
    throw new RevisionConflictError(current.revision);
  }

  const studentIds = mergeList(
    current.studentIds,
    patch.add?.studentIds,
    patch.remove?.studentIds,
  );
  const names = mergeList(
    current.names,
    patch.add?.names,
    patch.remove?.names,
  );
  const changes = {
    added: studentIds.added + names.added,
    removed: studentIds.removed + names.removed,
  };

  if (changes.added === 0 && changes.removed === 0) {
    return {
      policy: current,
      previousRevision: current.revision,
      changed: false,
      changes,
    };
  }

  const candidate = {
    schemaVersion: 1,
    revision: nextRevision(current.revision, now),
    studentIds: studentIds.items,
    names: names.items,
  };
  const validation = accessPolicySchema.safeParse(candidate);
  if (!validation.success) {
    throw new AccessPolicyMutationError(
      formatAccessPolicyIssues(validation.error.issues),
    );
  }

  return {
    policy: validation.data,
    previousRevision: current.revision,
    changed: true,
    changes,
  };
}

export function nextRevision(currentRevision: string, now: Date): string {
  const parsed = parseRevision(currentRevision);
  if (parsed === null) {
    throw new Error("Current access policy revision is invalid");
  }

  const today = shanghaiDate(now);
  if (parsed.date > today) {
    throw new Error("Current access policy revision date is in the future");
  }

  const nextVersion = parsed.date === today ? parsed.version + 1n : 1n;
  return `${today}-${nextVersion.toString().padStart(3, "0")}`;
}

function mergeList(
  current: string[],
  additions: string[] = [],
  removals: string[] = [],
): { items: string[]; added: number; removed: number } {
  const removalSet = new Set(removals);
  const items = current.filter((item) => !removalSet.has(item));
  const removed = current.length - items.length;
  const seen = new Set(items);
  let added = 0;

  for (const item of additions) {
    if (!seen.has(item)) {
      seen.add(item);
      items.push(item);
      added += 1;
    }
  }

  return { items, added, removed };
}

function shanghaiDate(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}
