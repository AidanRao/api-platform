import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";

import { errorResponse } from "./response";
import type { AccessIdentity, AppEnv } from "./types";

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export type AccessVerifier = (
  request: Request,
  env: AccessConfiguration,
) => Promise<AccessIdentity>;

export interface AccessConfiguration {
  TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENVIRONMENT: string;
  ACCESS_BYPASS_LOCAL: string;
}

export function accessAuth(verifier: AccessVerifier = verifyAccessRequest) {
  return createMiddleware<AppEnv>(async (context, next) => {
    if (isAccessBypassEnabled(context.env)) {
      context.set("accessIdentity", {
        email: null,
        subject: "local-development-bypass",
      });
      await next();
      return;
    }

    try {
      const identity = await verifier(context.req.raw, context.env);
      context.set("accessIdentity", identity);
      await next();
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        return errorResponse(error.message, 401, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      throw error;
    }
  });
}

export function isAccessBypassEnabled(env: AccessConfiguration): boolean {
  return (
    env.ENVIRONMENT === "development" && env.ACCESS_BYPASS_LOCAL === "true"
  );
}

export function createAccessVerifier(): AccessVerifier {
  const remoteJwksByTeamDomain = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();

  return async (request, env) => {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (token === null || token.length === 0) {
      throw new AccessDeniedError("缺少 Cloudflare Access 凭证");
    }

    const teamDomain = normalizeTeamDomain(env.TEAM_DOMAIN);
    if (
      env.ACCESS_AUD.length === 0 ||
      env.ACCESS_AUD === "REPLACE_WITH_ACCESS_APPLICATION_AUD"
    ) {
      throw new Error("Cloudflare Access ACCESS_AUD 尚未配置");
    }

    try {
      let jwks = remoteJwksByTeamDomain.get(teamDomain);
      if (jwks === undefined) {
        jwks = createRemoteJWKSet(
          new URL(`${teamDomain}/cdn-cgi/access/certs`),
        );
        remoteJwksByTeamDomain.set(teamDomain, jwks);
      }
      const { payload } = await jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
      });

      return {
        email: typeof payload.email === "string" ? payload.email : null,
        subject: typeof payload.sub === "string" ? payload.sub : null,
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        throw error;
      }
      throw new AccessDeniedError("Cloudflare Access 凭证无效");
    }
  };
}

export const verifyAccessRequest = createAccessVerifier();

function normalizeTeamDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Cloudflare Access TEAM_DOMAIN 配置无效");
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.hostname.startsWith("YOUR_TEAM.")
  ) {
    throw new Error("Cloudflare Access TEAM_DOMAIN 配置无效");
  }

  return url.origin;
}
