import { z } from "zod";
import { ApiError } from "../../../http/errors";
import { identitySchema } from "./schema";

const authorizationRowSchema = z.object({
  login_name: z.string().min(1),
  authorized_at: z.iso.datetime(),
  identity: identitySchema,
});
export type AuthorizationRow = z.infer<typeof authorizationRowSchema>;

export class IclassAuthorizationRepository {
  constructor(private readonly kv: KVNamespace) {}
  private key(userId: string) {
    return `buaa-classhopper:iclass:authorization:${encodeURIComponent(userId)}`;
  }
  async get(userId: string): Promise<AuthorizationRow | null> {
    try {
      const value = await this.kv.get(this.key(userId), "json");
      return value === null ? null : authorizationRowSchema.parse(value);
    } catch {
      throw new ApiError("授权存储暂时不可用，请稍后重试", 503);
    }
  }
  async put(userId: string, row: AuthorizationRow) {
    try {
      await this.kv.put(
        this.key(userId),
        JSON.stringify(row),
      );
    } catch {
      throw new ApiError("授权保存失败，请稍后重试", 503);
    }
  }
  async remove(userId: string) {
    try {
      await this.kv.delete(this.key(userId));
    } catch {
      throw new ApiError("授权撤销失败，请稍后重试", 503);
    }
  }
  private leaseKey(userId: string) {
    return `buaa-classhopper:iclass:signin-lease:${encodeURIComponent(userId)}`;
  }
  private async readLease(userId: string) {
    const value = await this.kv.get<{ leaseId: string; expiresAt: number }>(
      this.leaseKey(userId),
      "json",
    );
    if (
      value !== null &&
      (typeof value.leaseId !== "string" ||
        !value.leaseId ||
        !Number.isFinite(value.expiresAt))
    ) {
      throw new Error("invalid sign-in lease");
    }
    return value;
  }
  // KV has no compare-and-set: this suppresses observed duplicates, not all races.
  async acquire(userId: string, now: Date): Promise<string | null> {
    try {
      const current = await this.readLease(userId);
      if (current && current.expiresAt > now.getTime()) return null;
      const leaseId = crypto.randomUUID();
      await this.kv.put(
        this.leaseKey(userId),
        JSON.stringify({ leaseId, expiresAt: now.getTime() + 90_000 }),
        { expirationTtl: 90 },
      );
      return leaseId;
    } catch {
      throw new ApiError("签到状态存储暂时不可用，请稍后重试", 503);
    }
  }
  async release(userId: string, id: string) {
    try {
      if ((await this.readLease(userId))?.leaseId === id)
        await this.kv.delete(this.leaseKey(userId));
    } catch {
      // The TTL recovers abandoned leases; cleanup must not turn a confirmed sign-in into a failure.
      console.warn(
        JSON.stringify({ message: "iclass sign-in lease cleanup failed" }),
      );
    }
  }
}
