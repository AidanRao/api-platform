import { APPS, isAdminPage as matchesAdminPage, type AppDefinition } from "../apps/registry";
import { ossBucketOrigin } from "../infrastructure/oss";
import type { Context } from "hono";

import type { AppEnv } from "./types";

const ADMIN_DOCUMENT_PATH = "/admin/";
const ADMIN_ASSET_PREFIX = "/admin/assets/";

export async function serveAdminAsset(
  context: Context<AppEnv>,
  apps: readonly AppDefinition[] = APPS,
): Promise<Response> {
  const environment: string = context.env.ENVIRONMENT;
  const isDevelopment = environment === "development";
  if (context.req.method !== "GET" && context.req.method !== "HEAD") {
    return withSecurityHeaders(
      new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
      }),
      isDevelopment,
      ossBucketOrigin(context.env),
    );
  }

  const requestUrl = new URL(context.req.url);
  const isAdminPage = matchesAdminPage(requestUrl.pathname, apps);
  const isHashedAsset = requestUrl.pathname.startsWith(ADMIN_ASSET_PREFIX);

  if (!isAdminPage && !isHashedAsset) {
    return withSecurityHeaders(
      new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      }),
      isDevelopment,
      ossBucketOrigin(context.env),
    );
  }

  if (isAdminPage) requestUrl.pathname = ADMIN_DOCUMENT_PATH;
  const assetRequest = new Request(requestUrl, context.req.raw);
  const assetResponse = await context.env.ASSETS.fetch(assetRequest);
  const response = new Response(assetResponse.body, assetResponse);
  response.headers.set(
    "Cache-Control",
    isHashedAsset && assetResponse.ok
      ? "private, max-age=31536000, immutable"
      : "no-store",
  );
  return withSecurityHeaders(response, isDevelopment, ossBucketOrigin(context.env));
}

function withSecurityHeaders(
  response: Response,
  isDevelopment: boolean,
  imageOrigin: string | null,
): Response {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    // Radix positioning, sidebar variables and modal scroll locking use inline styles.
    "style-src 'self' 'unsafe-inline'",
    isDevelopment ? "connect-src 'self' ws:" : "connect-src 'self'",
    `img-src 'self' data: ${imageOrigin ?? ""}`.trim(),
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  return response;
}
