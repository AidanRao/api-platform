import { z } from "zod";

export type IclassNodeEnv = Pick<Env, "ENVIRONMENT" | "ICLASS_SERVICE_BASE_URL" | "ICLASS_SERVICE_SECRET"> & {
  ICLASS_SERVICE_BINDINGS?: unknown;
};
type Operation = "identity" | "schedule" | "sign" | "checkin";
type Binding = { fetch(request: Request): Promise<Response> };
type Node = { name: string; binding: Binding };

const readinessSchema = z.object({
  status: z.literal("ready"),
  upstream: z.object({ iclass: z.literal("available") }),
  checkin: z.object({
    limit: z.number().int().positive(),
    running: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    accepting: z.boolean(),
  }).refine((value) => value.available === value.limit - value.running &&
    value.accepting === (value.available > 0)),
});

function isBinding(value: unknown): value is Binding {
  return typeof value === "object" && value !== null && "fetch" in value && typeof value.fetch === "function";
}

// Enforce the caller's deadline even while consuming a response or using a test transport.
async function beforeDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    pending.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function bufferResponse(response: Response, signal: AbortSignal, limit = 4 * 1024 * 1024) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await beforeDeadline(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("iClass response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    // Cancel unread data after an error; releasing also detaches an interrupted read.
    try { await beforeDeadline(reader.cancel(), signal); } catch { /* Deadline already expired. */ }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function envelope(body: string): { code?: unknown; success?: unknown } {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null ? value : {};
  } catch { return {}; }
}

export class IclassNodePool {
  private readonly nodes: Node[];

  constructor(private readonly env: IclassNodeEnv) {
    if (!env.ICLASS_SERVICE_BASE_URL || !env.ICLASS_SERVICE_SECRET) {
      throw new Error("iClass service configuration is missing: ICLASS_SERVICE_BASE_URL or ICLASS_SERVICE_SECRET");
    }
    const base = new URL(env.ICLASS_SERVICE_BASE_URL);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("invalid iClass service URL");
    if (env.ENVIRONMENT !== "production") {
      this.nodes = [];
      return;
    }
    const parsed = z.array(z.string().trim().min(1)).nonempty().safeParse(env.ICLASS_SERVICE_BINDINGS);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
      throw new Error("invalid iClass service configuration: ICLASS_SERVICE_BINDINGS");
    }
    this.nodes = parsed.data.map((name) => {
      const binding: unknown = Reflect.get(env, name);
      if (!isBinding(binding)) throw new Error(`iClass service configuration is missing: ${name}`);
      return { name, binding };
    });
  }

  private log(node: string, operation: Operation, reason: string, started: number) {
    console.info(JSON.stringify({ message: "iclass node request", node, operation, reason,
      durationMs: Date.now() - started }));
  }

  async fetch(request: Request, loginName: string, operation: Operation): Promise<Response> {
    if (!loginName.trim()) throw new Error("iClass routing account is missing");
    const signal = request.signal;
    signal.throwIfAborted();
    // Development retains the existing direct HTTP transport without VPC discovery.
    if (this.env.ENVIRONMENT !== "production") {
      return bufferResponse(await beforeDeadline(fetch(request), signal), signal);
    }
    const ranked = await Promise.all(this.nodes.map(async (node) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([loginName, node.name])));
      return { ...node, score: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
    }));
    ranked.sort((a, b) => a.score < b.score ? 1 : a.score > b.score ? -1 : a.name.localeCompare(b.name));
    const healthy = await Promise.all(ranked.map(async (node) => {
      const started = Date.now();
      const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
      try {
        const response = await bufferResponse(await beforeDeadline(node.binding.fetch(new Request(
          new URL("/readyz", this.env.ICLASS_SERVICE_BASE_URL), { signal: probeSignal, redirect: "manual" },
        )), probeSignal), probeSignal, 16 * 1024);
        const parsed = readinessSchema.safeParse(response.ok ? await response.json() : null);
        if (!parsed.success) {
          this.log(node.name, operation, "not_ready", started);
          return null;
        }
        if (operation === "checkin" && !parsed.data.checkin.accepting) {
          this.log(node.name, operation, "at_capacity", started);
        }
        return { ...node, accepting: parsed.data.checkin.accepting };
      } catch {
        this.log(node.name, operation, "probe_failed", started);
        return null;
      }
    }));
    signal.throwIfAborted();
    const candidates = healthy.filter((node) => node !== null).filter((node) => operation !== "checkin" || node.accepting);
    if (!candidates.length) {
      const busy = operation === "checkin" && healthy.some((node) => node !== null);
      return Response.json({ code: busy ? 1004 : 2001, success: false, data: {},
        message: busy ? "check-in service is busy" : "iClass service unavailable" }, { status: 503 });
    }
    let lastResponse: Response | undefined;
    const retryableLookup = operation === "schedule" || operation === "identity";
    for (const node of candidates) {
      signal.throwIfAborted();
      const started = Date.now();
      try {
        const response = await bufferResponse(await beforeDeadline(node.binding.fetch(request.clone()), signal), signal);
        const payload = envelope(await response.clone().text());
        signal.throwIfAborted();
        const retry = retryableLookup
          ? ![1001, 1002, 2002, 2003, 2004].includes(Number(payload.code)) &&
            (response.status >= 500 || [2001, 2005].includes(Number(payload.code)))
          : response.status === 503 && payload.success === false && payload.code === 1004;
        this.log(node.name, operation, retry ? "retry_next_node" : "completed", started);
        if (!retry) return response;
        lastResponse = response;
      } catch (error) {
        this.log(node.name, operation, "request_failed", started);
        if (!retryableLookup || signal.aborted || node === candidates[candidates.length - 1]) throw error;
        lastResponse = undefined;
      }
    }
    signal.throwIfAborted();
    return lastResponse!;
  }
}
