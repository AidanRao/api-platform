import type { Context } from "hono";

import type { AppEnv } from "./types";

export const ADMIN_PAGE_PATH = "/admin/buaa-classhopper/";
const ADMIN_ASSET_PREFIX = "/admin/assets/";

export async function serveAdminAsset(
  context: Context<AppEnv>,
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
    );
  }

  const requestUrl = new URL(context.req.url);
  const isAdminPage =
    requestUrl.pathname === ADMIN_PAGE_PATH ||
    requestUrl.pathname === ADMIN_PAGE_PATH.slice(0, -1);
  const isHashedAsset = requestUrl.pathname.startsWith(ADMIN_ASSET_PREFIX);

  if (!isAdminPage && !isHashedAsset) {
    return withSecurityHeaders(
      new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      }),
      isDevelopment,
    );
  }

  const assetRequest = new Request(requestUrl, context.req.raw);
  const assetResponse = await context.env.ASSETS.fetch(assetRequest);
  const response = new Response(assetResponse.body, assetResponse);
  response.headers.set(
    "Cache-Control",
    isHashedAsset && assetResponse.ok
      ? "private, max-age=31536000, immutable"
      : "no-store",
  );
  return withSecurityHeaders(response, isDevelopment);
}

function withSecurityHeaders(
  response: Response,
  isDevelopment: boolean,
): Response {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    isDevelopment ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    isDevelopment ? "connect-src 'self' ws:" : "connect-src 'self'",
    "img-src 'self' data:",
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
