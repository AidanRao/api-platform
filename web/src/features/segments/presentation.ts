import type { MemberField } from "../../../../src/features/segments/schema";

export const memberFieldLabels: Record<MemberField, string> = { student_name: "姓名", student_id: "学号", sso_id: "SSO ID" };
export const parseMemberText = (text: string) => [...new Set(text.split(/[,，\r\n]+/).map((v) => v.trim()).filter(Boolean))].sort();
