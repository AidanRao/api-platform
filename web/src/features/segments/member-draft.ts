import { MEMBER_FIELDS, emptyMembers, type MemberField, type Members } from "../../../../src/features/segments/schema";
import { parseMemberText } from "./presentation";

export type MemberRow = { id: string; field: MemberField; value: string };
export type MemberDraft = { rows: MemberRow[]; pending: Record<MemberField, string> };

export function createMemberDraft(members: Members = emptyMembers()): MemberDraft {
  return {
    rows: MEMBER_FIELDS.flatMap((field) => members[field].map((value, index) => ({ id: `${field}:${index}`, field, value }))),
    pending: { student_name: "", student_id: "", sso_id: "" },
  };
}

export function memberDraftValues(draft: MemberDraft): Members {
  const members = emptyMembers();
  for (const row of draft.rows) members[row.field].push(row.value);
  for (const field of MEMBER_FIELDS) members[field].push(...parseMemberText(draft.pending[field]));
  return members;
}

export function appendPendingMembers(draft: MemberDraft, field: MemberField): MemberDraft {
  const existing = new Set(draft.rows.filter((row) => row.field === field).map((row) => row.value.trim()));
  const added = parseMemberText(draft.pending[field]).filter((value) => !existing.has(value));
  return {
    ...draft,
    rows: [...draft.rows, ...added.map((value) => ({ id: crypto.randomUUID(), field, value }))],
    pending: { ...draft.pending, [field]: "" },
  };
}
