import type { AppDefinition } from "./schema";
import { BUSINESS_KEY_PATTERN } from "../infrastructure/business-key";
export type { AppDefinition } from "./schema";

/** Application identity is code-maintained and independent of business capabilities. */

export function defineApps(apps: readonly AppDefinition[]): readonly AppDefinition[] {
  const ids = new Set<string>();
  for (const app of apps) {
    if (!BUSINESS_KEY_PATTERN.test(app.id) || ["admin", "assets", "index", "apps", "media", "token", "ads", "segments"].includes(app.id)) {
      throw new Error(`Invalid application ID: ${app.id}`);
    }
    if (ids.has(app.id) || !app.name.trim()) throw new Error(`Invalid or duplicate application: ${app.id}`);
    ids.add(app.id);
  }
  return Object.freeze(apps.map((app) => Object.freeze({ ...app })));
}

// Add new apps here. Common capabilities are provided to every registered app.
export const APPS = defineApps([
  { id: "buaa-classhopper", name: "BUAA ClassHopper" },
]);

export function findApp(id: string, apps: readonly AppDefinition[] = APPS): AppDefinition | undefined {
  return apps.find((app) => app.id === id);
}

export function appFromAdminPath(pathname: string, apps: readonly AppDefinition[] = APPS): AppDefinition | undefined {
  const match = /^\/admin\/([^/]+)(?:\/|$)/.exec(pathname);
  return match?.[1] ? findApp(match[1], apps) : undefined;
}

export function appApiPath(appId: string, admin = false): string {
  return `/api/${admin ? "admin/" : ""}${encodeURIComponent(appId)}`;
}

export function isAdminPage(pathname: string, apps: readonly AppDefinition[] = APPS): boolean {
  if (/^\/admin\/?$/.test(pathname)) return true;
  if (/^\/admin\/ads\/(?:campaigns|creatives)(?:\/[^/]+)?\/?$/.test(pathname)) return true;
  if (/^\/admin\/segments(?:\/(?:new|SEGM-\d{8}-[A-Z0-9]{10}))?\/?$/.test(pathname)) return true;
  const app = appFromAdminPath(pathname, apps);
  if (!app) return false;
  const page = pathname.slice(`/admin/${app.id}`.length).replace(/\/$/, "");
  return /^\/ads\/(?:slots|placements)(?:\/[^/]+)?$/.test(page) || page === "" || /^\/announcements(?:\/[^/]+)?$/.test(page)
    || /^\/versions(?:\/(?:new|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)))?$/.test(page)
    || page === "/api-tokens" || page === "/api-tokens/new"
    || (app.id === "buaa-classhopper" && (page === "/whitelist" || page === "/reservations"));
}
