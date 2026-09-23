import { afterEach, describe, expect, it, vi } from "vitest";
import { imageExtension, MAX_IMAGE_BYTES, ossBucketOrigin, signOssPut, uploadImage } from "../src/infrastructure/oss";
afterEach(() => vi.restoreAllMocks());
const config = {
  OSS_BUCKET: "examplebucket", OSS_REGION: "cn-hangzhou",
  OSS_PREFIX: "api-platform", OSS_ACCESS_KEY_ID: "test-key", OSS_ACCESS_KEY_SECRET: "test-secret",
};
const now = new Date("2026-09-22T08:00:00.000Z");
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
const request = (bytes: Uint8Array = png, type = "image/png") => new Request("https://example.com/images", { method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(bytes) });

describe("OSS uploads", () => {
  it("matches a known-answer OSS V4 request cross-checked with Python hashlib", async () => {
    // Canonical request from Alibaba's V4 documentation; hash is c46d9639...b63136eca.
    // Expected signature independently derived with Python hmac/hashlib using the documented
    // literal secret. The documentation's displayed final signature uses a different signing key.
    const headers = new Headers({ "content-disposition": "attachment", "content-length": "3", "content-md5": "ICy5YqxZB1uWSwcVLSNLcA==", "content-type": "text/plain", "x-oss-content-sha256": "UNSIGNED-PAYLOAD", "x-oss-date": "20250411T064124Z" });
    expect(await signOssPut("examplebucket", "exampleobject", "cn-hangzhou", "example-key", "yourAccessKeySecret", headers, ["content-disposition", "content-length"]))
      .toContain("Signature=d3694c2dfc5371ee6acd35e88c4871ac95a7ba01d3a2f476768fe61218590097");
  });
  it("uploads signed bytes with a platform prefix and returns a stable public URL", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await uploadImage(config, request(), now, send);
    expect(result.url).toMatch(/^https:\/\/examplebucket.oss-cn-hangzhou.aliyuncs.com\/api-platform\/images\/[a-f0-9-]+\.png$/);
    const [url, init] = send.mock.calls[0]!;
    expect(result.url).toBe(String(url));
    expect(String(url)).toContain("https://examplebucket.oss-cn-hangzhou.aliyuncs.com/api-platform/images/");
    expect(new Headers(init?.headers).get("Authorization")).toContain("OSS4-HMAC-SHA256 Credential=test-key/20260922/cn-hangzhou/oss/aliyun_v4_request");
    expect(init?.body).toEqual(png);
    expect(init?.redirect).toBe("manual");
  });
  it("constructs an outbound request with the real runtime Request implementation", async () => {
    const send: typeof fetch = async (input, init) => {
      const outbound = new Request(input, init);
      expect(outbound.method).toBe("PUT");
      return new Response(null, { status: 200 });
    };
    await expect(uploadImage(config, request(), now, send)).resolves.toHaveProperty("url");
  });
  it("validates headers, MIME and size before sending", async () => {
    const send = vi.fn<typeof fetch>();
    for (const input of [request(png, "image/jpeg"), request(new TextEncoder().encode("<svg/>"), "image/svg+xml"), request(new Uint8Array())]) {
      await expect(uploadImage(config, input, now, send)).rejects.toMatchObject({ status: 400 });
    }
    await expect(uploadImage(config, request(new Uint8Array(MAX_IMAGE_BYTES + 1)), now, send)).rejects.toMatchObject({ status: 413 });
    expect(send).not.toHaveBeenCalled();
  });
  it("accepts the supported file signatures", () => {
    expect(imageExtension(png, "image/png")).toBe("png");
    expect(imageExtension(Uint8Array.from([255,216,255,224]), "image/jpeg")).toBe("jpg");
    expect(imageExtension(new TextEncoder().encode("GIF89a1234567"), "image/gif")).toBe("gif");
    expect(imageExtension(new TextEncoder().encode("RIFF1234WEBPVP8 "), "image/webp")).toBe("webp");
  });
  it("reports upstream rejections and network errors without exposing credentials", async () => {
    for (const send of [vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive upstream text", { status: 403 })), vi.fn<typeof fetch>().mockRejectedValue(new Error("network secret"))]) {
      await expect(uploadImage(config, request(), now, send)).rejects.toMatchObject({ status: 502, message: "图片上传失败，请稍后重试" });
    }
  });
  it("rejects redirects without following them and logs only safe OSS diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("<Error><Code>AccessDenied</Code><Message>test-secret</Message></Error>", { status: 403, headers: { "x-oss-request-id": "request-123" } }));
    await expect(uploadImage(config, request(), now, send)).rejects.toMatchObject({ status: 502 });
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({ event: "oss_upload_failed", phase: "response", status: 403, code: "AccessDenied", requestId: "request-123" });
    send.mockResolvedValue(new Response(null, { status: 307, headers: { Location: "https://untrusted.example/" } }));
    await expect(uploadImage(config, request(), now, send)).rejects.toMatchObject({ status: 502 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]?.redirect).toBe("manual");
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
  });
  it("logs runtime failure types without including exception messages or secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("test-secret"));
    await expect(uploadImage(config, request(), now, send)).rejects.toMatchObject({ status: 502 });
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({ event: "oss_upload_failed", phase: "request", errorType: "TypeError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
  });
  it("derives bucket origins and rejects unsafe names before sending", async () => {
    expect(ossBucketOrigin(config)).toBe("https://examplebucket.oss-cn-hangzhou.aliyuncs.com");
    expect(ossBucketOrigin({ OSS_BUCKET: "other-bucket", OSS_REGION: "ap-southeast-1" })).toBe("https://other-bucket.oss-ap-southeast-1.aliyuncs.com");
    const send = vi.fn<typeof fetch>();
    for (const invalid of [
      { OSS_BUCKET: "" }, { OSS_BUCKET: "bucket.attacker.com" }, { OSS_BUCKET: "bucket/path" },
      { OSS_REGION: "" }, { OSS_REGION: "cn-hangzhou.attacker.com" }, { OSS_REGION: "cn-hangzhou/path" },
    ]) {
      const environment = { ...config, ...invalid };
      expect(ossBucketOrigin(environment)).toBeNull();
      await expect(uploadImage(environment, request(), now, send)).rejects.toMatchObject({ status: 503 });
    }
    await expect(uploadImage({ ...config, OSS_ACCESS_KEY_SECRET: "" }, request(), now, send)).rejects.toMatchObject({ status: 503 });
    expect(send).not.toHaveBeenCalled();
  });
});
