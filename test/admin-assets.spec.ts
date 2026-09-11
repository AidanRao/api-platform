import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const authenticated = async () => ({
  email: "admin@example.com",
  subject: "admin-subject",
});

describe("administrator static assets", () => {
  it("requires Access authentication for the management page", async () => {
    const response = await createApp().request(
      "https://example.com/admin/buaa-classhopper/",
      undefined,
      env,
    );

    expect(response.status).toBe(401);
  });

  it("serves authenticated HTML through the ASSETS binding", async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html><title>管理页</title>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const response = await requestAsset(
      "/admin/buaa-classhopper/",
      assetFetch,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "'unsafe-inline'",
    );
    expect(new URL(assetFetch.mock.calls[0]?.[0].url).pathname).toBe(
      "/admin/buaa-classhopper/",
    );
  });

  it("bypasses Access only in the local development environment", async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html><title>本地管理页</title>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const verifier = vi.fn().mockRejectedValue(new Error("must not run"));
    const bindings = Object.assign(Object.create(env) as Env, {
      ENVIRONMENT: "development",
      ACCESS_BYPASS_LOCAL: "true",
      ASSETS: { fetch: assetFetch },
    });

    const response = await createApp(verifier).request(
      "https://example.com/admin/buaa-classhopper/",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    expect(verifier).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
  });

  it("uses private immutable caching for hashed administrator assets", async () => {
    const assetFetch = vi.fn().mockResolvedValue(
      new Response("export{}", {
        headers: { "Content-Type": "text/javascript" },
      }),
    );
    const response = await requestAsset("/admin/assets/app-a1b2c3.js", assetFetch);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("does not fall back to the management HTML for unknown paths", async () => {
    const assetFetch = vi.fn();
    const response = await requestAsset("/admin/unknown.js", assetFetch);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(assetFetch).not.toHaveBeenCalled();
  });
});

async function requestAsset(path: string, assetFetch: ReturnType<typeof vi.fn>) {
  const bindings = Object.assign(Object.create(env) as Env, {
    ASSETS: { fetch: assetFetch },
  });
  return createApp(authenticated).request(
    `https://example.com${path}`,
    undefined,
    bindings,
  );
}
