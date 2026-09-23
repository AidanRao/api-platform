import { ApiError } from "../http/errors";

export interface OssSecrets { OSS_ACCESS_KEY_ID?: string; OSS_ACCESS_KEY_SECRET?: string; }
type OssEnvironment = OssSecrets & {
  OSS_BUCKET: string; OSS_REGION: string; OSS_PREFIX: string;
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
const encodePath = (path: string) => path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
async function hmac(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

// OSS V4 uses the bucket in the canonical path, including for virtual-hosted requests.
export async function signOssPut(
  bucket: string, key: string, region: string, accessKeyId: string, secret: string,
  headers: Headers, additionalHeaders: string[] = [],
): Promise<string> {
  const timestamp = headers.get("x-oss-date")!;
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${region}/oss/aliyun_v4_request`;
  const additional = [...additionalHeaders].sort();
  const canonicalHeaders = [...headers.entries()]
    .filter(([name]) => name === "content-type" || name === "content-md5" || name.startsWith("x-oss-") || additional.includes(name))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => `${name}:${value.trim()}\n`).join("");
  const canonical = ["PUT", encodePath(`/${bucket}/${key}`), "", canonicalHeaders, additional.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const hash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(canonical)));
  let signingKey = await hmac(encoder.encode(`aliyun_v4${secret}`), date);
  for (const value of [region, "oss", "aliyun_v4_request"]) signingKey = await hmac(signingKey, value);
  const signature = hex((await hmac(signingKey, `OSS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash}`)).buffer);
  return `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ${additional.length ? `AdditionalHeaders=${additional.join(";")}, ` : ""}Signature=${signature}`;
}

export function imageExtension(bytes: Uint8Array, mime: string): string {
  const starts = (...values: number[]) => values.every((v, i) => bytes[i] === v);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === "image/jpeg" && bytes.length >= 4 && starts(0xff, 0xd8, 0xff)) return "jpg";
  if (mime === "image/png" && bytes.length >= 24 && starts(137, 80, 78, 71, 13, 10, 26, 10) && ascii(12, 16) === "IHDR") return "png";
  if (mime === "image/gif" && bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "gif";
  if (mime === "image/webp" && bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  throw new ApiError("仅支持文件头与类型一致的 JPEG、PNG、WebP、GIF 图片", 400);
}

/** The same validated bucket origin is used for PUT, public URLs and the admin CSP. */
export function ossBucketOrigin(env: Pick<OssEnvironment, "OSS_BUCKET" | "OSS_REGION">): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.OSS_BUCKET) || !/^[a-z0-9-]+$/.test(env.OSS_REGION)) return null;
  return `https://${env.OSS_BUCKET}.oss-${env.OSS_REGION}.aliyuncs.com`;
}

function configuration(env: OssEnvironment) {
  if (!env.OSS_BUCKET || !env.OSS_REGION || !env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) {
    throw new ApiError("图片上传尚未配置 OSS", 503);
  }
  const prefix = env.OSS_PREFIX.replace(/^\/+|\/+$/g, "");
  const origin = ossBucketOrigin(env);
  if (!origin || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) {
    throw new ApiError("OSS 配置无效，请检查 Bucket、Region 和路径前缀", 503);
  }
  return { ...env, prefix, origin, accessKeyId: env.OSS_ACCESS_KEY_ID, secret: env.OSS_ACCESS_KEY_SECRET };
}

export async function uploadImage(env: OssEnvironment, request: Request, now: Date, send: typeof fetch = (input, init) => fetch(input, init)) {
  const config = configuration(env);
  const mime = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!request.body) throw new ApiError("请选择图片", 400);
  // Count the actual bytes, even when a client supplies a misleading Content-Length.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ApiError("图片不能超过 5 MiB", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const ext = imageExtension(bytes, mime);
  const key = `${config.prefix}/images/${crypto.randomUUID()}.${ext}`;
  const headers = new Headers({
    "Content-Type": mime, "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
    "x-oss-date": now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""),
    "x-oss-forbid-overwrite": "true",
  });
  headers.set("Authorization", await signOssPut(config.OSS_BUCKET, key, config.OSS_REGION, config.accessKeyId, config.secret, headers));
  const url = `${config.origin}/${encodePath(key)}`;
  let response: Response;
  try {
    response = await send(url, {
      // workerd rejects redirect: "error" before sending. Never forward signed headers.
      method: "PUT", headers, body: bytes, redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const errorType = error instanceof Error && ["TypeError", "TimeoutError", "AbortError"].includes(error.name) ? error.name : "Error";
    console.error(JSON.stringify({ event: "oss_upload_failed", phase: "request", errorType }));
    throw new ApiError("图片上传失败，请稍后重试", 502);
  }
  if (!response.ok) {
    // Only log bounded diagnostic identifiers, never XML bodies, signing data or credentials.
    const code = await ossErrorCode(response);
    const requestId = response.headers.get("x-oss-request-id");
    console.error(JSON.stringify({ event: "oss_upload_failed", phase: "response", status: response.status,
      code, requestId: requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? requestId : null }));
    throw new ApiError("图片上传失败，请稍后重试", 502);
  }
  // Releasing an unused success body must not turn a completed PUT into a failed upload.
  await response.body?.cancel().catch(() => undefined);
  return { url };
}

async function ossErrorCode(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "";
  let remaining = 8192;
  try {
    while (remaining > 0) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, remaining);
      text += decoder.decode(chunk, { stream: true });
      remaining -= chunk.byteLength;
    }
    return /<Code>([a-zA-Z0-9_]{1,128})<\/Code>/.exec(text)?.[1] ?? null;
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
