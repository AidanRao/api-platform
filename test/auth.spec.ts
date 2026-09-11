import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccessDeniedError,
  createAccessVerifier,
  isAccessBypassEnabled,
} from "../src/http/access-auth";

const teamDomain = "https://classhopper.cloudflareaccess.com";
const audience = "test-application-audience";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cloudflare Access authentication", () => {
  it("validates a signed Access JWT and returns its identity", async () => {
    const { token, jwks } = await createToken(audience);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(jwks));

    const identity = await createAccessVerifier()(
      new Request("https://api.example.com/api/admin/resource", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }),
      accessEnvironment,
    );

    expect(identity).toEqual({
      email: "admin@example.com",
      subject: "admin-subject",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${teamDomain}/cdn-cgi/access/certs`,
      expect.anything(),
    );
  });

  it("rejects a JWT issued for another Access application", async () => {
    const { token, jwks } = await createToken("another-audience");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(jwks));

    await expect(
      createAccessVerifier()(
        new Request("https://api.example.com/api/admin/resource", {
          headers: { "Cf-Access-Jwt-Assertion": token },
        }),
        accessEnvironment,
      ),
    ).rejects.toEqual(
      new AccessDeniedError("Cloudflare Access 凭证无效"),
    );
  });

  it("rejects a JWT from another issuer", async () => {
    const { token, jwks } = await createToken(audience, {
      issuer: "https://other.cloudflareaccess.com",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(jwks));

    await expect(
      createAccessVerifier()(requestWithToken(token), accessEnvironment),
    ).rejects.toEqual(new AccessDeniedError("Cloudflare Access 凭证无效"));
  });

  it("rejects an expired JWT", async () => {
    const { token, jwks } = await createToken(audience, {
      expirationTime: "0s",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(jwks));

    await expect(
      createAccessVerifier()(requestWithToken(token), accessEnvironment),
    ).rejects.toEqual(new AccessDeniedError("Cloudflare Access 凭证无效"));
  });

  it("rejects a request without an Access JWT", async () => {
    await expect(
      createAccessVerifier()(
        new Request("https://api.example.com/api/admin/resource"),
        accessEnvironment,
      ),
    ).rejects.toEqual(
      new AccessDeniedError("缺少 Cloudflare Access 凭证"),
    );
  });

  it("only enables bypass for an explicit local development configuration", () => {
    expect(
      isAccessBypassEnabled({
        ...accessEnvironment,
        ENVIRONMENT: "development",
        ACCESS_BYPASS_LOCAL: "true",
      }),
    ).toBe(true);
    expect(
      isAccessBypassEnabled({
        ...accessEnvironment,
        ENVIRONMENT: "production",
        ACCESS_BYPASS_LOCAL: "true",
      }),
    ).toBe(false);
    expect(
      isAccessBypassEnabled({
        ...accessEnvironment,
        ENVIRONMENT: "development",
        ACCESS_BYPASS_LOCAL: "false",
      }),
    ).toBe(false);
  });

  it("reuses the remote JWK set between authenticated requests", async () => {
    const { token, jwks } = await createToken(audience);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(jwks));
    const verify = createAccessVerifier();

    await verify(requestWithToken(token), accessEnvironment);
    await verify(requestWithToken(token), accessEnvironment);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const accessEnvironment = {
  TEAM_DOMAIN: teamDomain,
  ACCESS_AUD: audience,
  ENVIRONMENT: "production",
  ACCESS_BYPASS_LOCAL: "false",
};

function requestWithToken(token: string): Request {
  return new Request("https://api.example.com/api/admin/resource", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

async function createToken(
  tokenAudience: string,
  options: { issuer?: string; expirationTime?: string } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });

  const token = await new SignJWT({ email: "admin@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer ?? teamDomain)
    .setAudience(tokenAudience)
    .setSubject("admin-subject")
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? "5m")
    .sign(privateKey);

  return { token, jwks: { keys: [jwk] } };
}
