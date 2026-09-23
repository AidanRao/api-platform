import type { AppDefinition } from "../../../src/apps/schema";
export interface AdminSection { readonly id: string; readonly label: string }
const commonSections: readonly AdminSection[] = [{ id: "announcements", label: "公告管理" }];
const appSections: Readonly<Record<string, readonly AdminSection[]>> = {
  "buaa-classhopper": [{ id: "whitelist", label: "白名单管理" }],
};
export function sectionsForApp(app: AppDefinition): readonly AdminSection[] {
  return [...(appSections[app.id] ?? []), ...commonSections];
}
export function appLandingPath(app: AppDefinition, section?: string): string {
  const sections = sectionsForApp(app);
  return `/admin/${encodeURIComponent(app.id)}/${sections.find((item) => item.id === section)?.id ?? sections[0]!.id}`;
}
