import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";

import { ApiError } from "./errors";
import type { AppEnv, SsoIdentity } from "./types";

export type SsoVerifier = (request: Request, issuer: string, appId: string) => Promise<SsoIdentity>;

export function bearerToken(request: Request): string {
  const value = request.headers.get("Authorization");
  if (!value || !/^Bearer [^\s]+$/i.test(value)) throw new ApiError("缺少 Bearer 凭证", 401);
  return value.slice(7);
}

export function createSsoVerifier(): SsoVerifier {
  const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  return async (request, issuer, appId) => {
    const token = bearerToken(request);
    let url: URL;
    try {
      url = new URL(issuer);
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new Error("invalid issuer");
      }
    } catch {
      throw new ApiError("SSO issuer 配置无效", 503);
    }
    let keys = sets.get(url.origin);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", url), {
        cacheMaxAge: 300_000,
        timeoutDuration: 5_000,
      });
      sets.set(url.origin, keys);
    }
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: url.origin,
        audience: `api-platform-${appId}`,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"],
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim() ||
          typeof payload.client_id !== "string" || !payload.client_id.trim()) {
        throw new ApiError("SSO 凭证无效", 401);
      }
      return { userId: payload.sub, clientId: payload.client_id };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof errors.JOSEError) {
        if (["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"].includes(error.code)) {
          throw new ApiError("SSO 公钥暂时不可用", 503);
        }
        throw new ApiError("SSO 凭证无效", 401);
      }
      throw new ApiError("SSO 公钥暂时不可用", 503);
    }
  };
}

export const verifySsoRequest = createSsoVerifier();

export function ssoAuth(appId: string, verifier: SsoVerifier = verifySsoRequest) {
  return createMiddleware<AppEnv>(async (context, next) => {
    const identity = await verifier(context.req.raw, context.env.SSO_ISSUER, appId);
    context.set("ssoIdentity", identity);
    await next();
  });
}
