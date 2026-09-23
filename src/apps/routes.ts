import { Hono } from "hono";
import type { AppEnv } from "../http/types";
import { createAdminBuaaClasshopperRoutes, createPublicBuaaClasshopperRoutes } from "../domains/buaa-classhopper/routes";
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from "../features/announcements/routes";
import { appApiPath, type AppDefinition } from "./registry";

/** Composition root: common capabilities are peers, application extensions are separate. */
export function mountAppRoutes(router: Hono<AppEnv>, apps: readonly AppDefinition[], now: () => Date) {
  for (const app of apps) {
    const publicRoutes = new Hono<AppEnv>();
    const adminRoutes = new Hono<AppEnv>();
    publicRoutes.route("/announcement", createPublicAnnouncementRoutes(app.id));
    adminRoutes.route("/announcement", createAdminAnnouncementRoutes(app.id, now));

    // BUAA's iClass whitelist is an app-specific extension, not a common capability.
    if (app.id === "buaa-classhopper") {
      publicRoutes.route("/", createPublicBuaaClasshopperRoutes());
      adminRoutes.route("/", createAdminBuaaClasshopperRoutes(now));
    }
    router.route(appApiPath(app.id), publicRoutes);
    router.route(appApiPath(app.id, true), adminRoutes);
  }
}
