import type {
  AccessPolicy,
  AccessPolicyPatch,
} from "../../../../../src/domains/buaa-classhopper/access-policy/schema";

export type PolicyField = "studentIds" | "names";

export interface PolicyDraft {
  add: Record<PolicyField, string[]>;
  remove: Record<PolicyField, string[]>;
}

export interface DraftCounts {
  added: number;
  removed: number;
  total: number;
}

export function createEmptyDraft(): PolicyDraft {
  return {
    add: { studentIds: [], names: [] },
    remove: { studentIds: [], names: [] },
  };
}

export function normalizeDraft(
  policy: AccessPolicy,
  draft: PolicyDraft,
): PolicyDraft {
  return {
    add: {
      studentIds: draft.add.studentIds.filter(
        (item) => !policy.studentIds.includes(item),
      ),
      names: draft.add.names.filter((item) => !policy.names.includes(item)),
    },
    remove: {
      studentIds: draft.remove.studentIds.filter((item) =>
        policy.studentIds.includes(item),
      ),
      names: draft.remove.names.filter((item) => policy.names.includes(item)),
    },
  };
}

export function stageAddition(
  policy: AccessPolicy,
  draft: PolicyDraft,
  field: PolicyField,
  rawValue: string,
): { draft: PolicyDraft; error: string | null } {
  const value = rawValue.trim();
  const maxLength = field === "studentIds" ? 64 : 100;
  if (value.length === 0) {
    return { draft, error: "请输入内容" };
  }
  if (value.length > maxLength) {
    return { draft, error: `不能超过 ${maxLength} 个字符` };
  }

  if (draft.remove[field].includes(value)) {
    return {
      draft: updateField(draft, "remove", field, (items) =>
        items.filter((item) => item !== value),
      ),
      error: null,
    };
  }
  if (policy[field].includes(value)) {
    return { draft, error: "该项已在白名单中" };
  }
  if (draft.add[field].includes(value)) {
    return { draft, error: "该项已在待新增列表中" };
  }
  const retainedCount = policy[field].length - draft.remove[field].length;
  if (retainedCount + draft.add[field].length >= 500) {
    return { draft, error: "白名单最多包含 500 项" };
  }

  return {
    draft: updateField(draft, "add", field, (items) => [...items, value]),
    error: null,
  };
}

export function stageRemoval(
  draft: PolicyDraft,
  field: PolicyField,
  value: string,
): PolicyDraft {
  if (draft.add[field].includes(value)) {
    return updateField(draft, "add", field, (items) =>
      items.filter((item) => item !== value),
    );
  }
  if (draft.remove[field].includes(value)) {
    return draft;
  }
  return updateField(draft, "remove", field, (items) => [...items, value]);
}

export function undoRemoval(
  draft: PolicyDraft,
  field: PolicyField,
  value: string,
): PolicyDraft {
  return updateField(draft, "remove", field, (items) =>
    items.filter((item) => item !== value),
  );
}

export function getDraftCounts(draft: PolicyDraft): DraftCounts {
  const added = draft.add.studentIds.length + draft.add.names.length;
  const removed = draft.remove.studentIds.length + draft.remove.names.length;
  return { added, removed, total: added + removed };
}

export function buildPatch(
  policy: AccessPolicy,
  draft: PolicyDraft,
): AccessPolicyPatch | null {
  const effective = normalizeDraft(policy, draft);
  if (getDraftCounts(effective).total === 0) {
    return null;
  }

  const patch: AccessPolicyPatch = { baseRevision: policy.revision };
  const add = compactGroup(effective.add);
  const remove = compactGroup(effective.remove);
  if (add !== undefined) patch.add = add;
  if (remove !== undefined) patch.remove = remove;
  return patch;
}

function compactGroup(group: Record<PolicyField, string[]>) {
  if (group.studentIds.length === 0 && group.names.length === 0) {
    return undefined;
  }
  return {
    ...(group.studentIds.length > 0 ? { studentIds: [...group.studentIds] } : {}),
    ...(group.names.length > 0 ? { names: [...group.names] } : {}),
  };
}

function updateField(
  draft: PolicyDraft,
  operation: "add" | "remove",
  field: PolicyField,
  update: (items: string[]) => string[],
): PolicyDraft {
  return {
    ...draft,
    [operation]: {
      ...draft[operation],
      [field]: update(draft[operation][field]),
    },
  };
}
