import { ApiError } from "../../http/errors";
import { AnnouncementRepository } from "./repository";
import type { Announcement, PatchAnnouncement } from "./schema";

export async function requireAnnouncement(repo: AnnouncementRepository, id: string) {
  const current = await repo.get(id);
  if (!current) throw new ApiError("公告不存在", 404);
  return current;
}
export async function conflict(repo: AnnouncementRepository, id: string): Promise<never> {
  const current = await requireAnnouncement(repo, id);
  throw new ApiError("公告已被其他管理员修改，请检查最新版本", 409, { currentRevision: current.revision });
}
export async function mutateAnnouncement(
  repo: AnnouncementRepository, id: string, revision: number,
  action: "patch" | "publish" | "unpublish" | "delete", now: Date, patch?: PatchAnnouncement,
): Promise<Announcement | null> {
  const current = await requireAnnouncement(repo, id);
  if (current.revision !== revision) return conflict(repo, id);
  if (action === "delete") {
    if (!await repo.delete(id, revision)) return conflict(repo, id);
    return null;
  }
  const next = { ...current };
  if (action === "patch" && patch) {
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.content !== undefined) next.content = patch.content;
    if (patch.isPinned !== undefined) next.isPinned = patch.isPinned;
  }
  if (action === "publish") {
    next.status = "published";
    next.publishedAt ??= now.toISOString();
  }
  if (action === "unpublish") {
    if (current.status !== "published") throw new ApiError("只有已发布公告可以下架", 400);
    next.status = "unpublished";
  }
  if (next.status === "published" && !next.content.trim()) throw new ApiError("发布的公告正文不能为空", 400);
  const updated = await repo.update(next, now.toISOString());
  if (!updated) return conflict(repo, id);
  return updated;
}
