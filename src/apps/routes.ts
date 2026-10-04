import { Hono } from "hono";
import type { AppEnv } from "../http/types";
import { createAdminBuaaClasshopperRoutes, createPublicBuaaClasshopperRoutes } from "../domains/buaa-classhopper/access-policy/routes";
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from "../features/announcements/routes";
import { createAdminApiTokenRoutes } from "../features/api-tokens/routes";
import { createAdminReservationRoutes, createApiTokenReservationRoutes, createSsoReservationRoutes } from "../domains/buaa-classhopper/reservations/routes";
import type { SsoVerifier } from "../http/sso-auth";
import { appApiPath, type AppDefinition } from "./registry";

/** Composition root: common capabilities are peers, application extensions are separate. */
export function mountAppRoutes(router: Hono<AppEnv>, apps: readonly AppDefinition[], now: () => Date, verifySso?: SsoVerifier) {
  for (const app of apps) {
    const publicRoutes = new Hono<AppEnv>();
    const adminRoutes = new Hono<AppEnv>();
    publicRoutes.route("/announcement", createPublicAnnouncementRoutes(app.id));
    adminRoutes.route("/announcement", createAdminAnnouncementRoutes(app.id, now));
    adminRoutes.route("/api-tokens", createAdminApiTokenRoutes(app.id, now));

    // BUAA-specific capabilities are mounted only for this registered App.
    if (app.id === "buaa-classhopper") {
      publicRoutes.route("/", createPublicBuaaClasshopperRoutes());
      adminRoutes.route("/", createAdminBuaaClasshopperRoutes(now));
      adminRoutes.route("/reservations", createAdminReservationRoutes(now));
      publicRoutes.route("/reservations", createSsoReservationRoutes(now, verifySso));
      router.route("/api/token/buaa-classhopper/reservations", createApiTokenReservationRoutes());
    }
    router.route(appApiPath(app.id), publicRoutes);
    router.route(appApiPath(app.id, true), adminRoutes);
  }
}
