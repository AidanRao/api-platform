import {
  accessPolicySchema,
  type AccessPolicy,
  type AccessPolicyPatch,
} from "../../src/domains/buaa-classhopper/access-policy.schema";

const PUBLIC_POLICY_URL = "/api/buaa-classhopper/v1/iclass/access-policy";
const ADMIN_POLICY_URL = "/api/admin/buaa-classhopper/v1/iclass/access-policy";

export class PolicyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: "uninitialized" | "conflict" | "authentication" | "request",
  ) {
    super(message);
    this.name = "PolicyApiError";
  }
}

export async function fetchPolicy(signal?: AbortSignal): Promise<AccessPolicy> {
  const response = await fetch(PUBLIC_POLICY_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return readPolicyResponse(response, "无法加载白名单");
}

export async function patchPolicy(
  patch: AccessPolicyPatch,
): Promise<AccessPolicy> {
  const response = await fetch(ADMIN_POLICY_URL, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  return readPolicyResponse(response, "无法保存白名单");
}

async function readPolicyResponse(
  response: Response,
  fallbackMessage: string,
): Promise<AccessPolicy> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new PolicyApiError(
      "登录状态可能已过期，请重新加载页面",
      response.status,
      "authentication",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PolicyApiError(
      "服务器返回了无法识别的响应，请重新加载",
      response.status,
      "request",
    );
  }

  const envelope = asEnvelope(body);
  if (!response.ok) {
    const message = envelope?.msg ?? fallbackMessage;
    if (response.status === 503) {
      throw new PolicyApiError(message, response.status, "uninitialized");
    }
    if (response.status === 409) {
      throw new PolicyApiError(message, response.status, "conflict");
    }
    if (response.status === 401 || response.status === 403) {
      throw new PolicyApiError(message, response.status, "authentication");
    }
    throw new PolicyApiError(message, response.status, "request");
  }

  const parsed = accessPolicySchema.safeParse(envelope?.data);
  if (!parsed.success) {
    throw new PolicyApiError(
      "服务器返回的白名单格式不正确",
      response.status,
      "request",
    );
  }
  return parsed.data;
}

function asEnvelope(value: unknown): { msg?: string; data?: unknown } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.msg === "string" ? { msg: record.msg } : {}),
    data: record.data,
  };
}
