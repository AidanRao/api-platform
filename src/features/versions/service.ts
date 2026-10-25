import type { z } from "zod";
import { ApiError } from "../../http/errors";
import { VersionRepository } from "./repository";
import { matchesMembers, type SegmentReader } from "../segments/schema";
import { effectiveVersion, type CreateVersion, type patchVersionSchema } from "./schema";

const conflict = () => new ApiError("记录或分配设置已变化，请刷新核对后重试", 409);
export class VersionService {
  constructor(readonly repo: VersionRepository, private readonly segments: SegmentReader, private readonly now: () => Date) {}
  async require(version: string) {
    const value = await this.repo.get(version);
    if (!value) throw new ApiError("版本不存在", 404);
    return value;
  }
  async create(input: CreateVersion) {
    const value = await this.repo.create(input, this.now().toISOString());
    if (!value) throw new ApiError("版本号已存在或所选人群已失效，请刷新核对后重试", 409);
    return value;
  }
  async update(version: string, input: z.infer<typeof patchVersionSchema>) {
    const current = await this.require(version);
    if (input.releaseType === "gray" && (await this.repo.settings()).latestVersion === version) {
      throw new ApiError("最新版本必须为全量，请先更改最新版本设置", 409);
    }
    if ((input.releaseType ?? current.releaseType) === "full" && input.segmentIds?.length) {
      throw new ApiError("只有灰度版本可以配置人群", 409);
    }
    const value = await this.repo.update(version, input.revision, { ...current, ...input }, this.now().toISOString());
    if (!value) throw conflict();
    return value;
  }
  async delete(version: string, revision: number) {
    await this.require(version);
    if (!await this.repo.delete(version, revision)) throw new ApiError("无法删除：版本仍是最新版本、关联灰度人群或记录已变化", 409);
  }
  async settings() {
    const { latestVersion, revision } = await this.repo.settings();
    return { latestVersion, revision };
  }
  async setLatest(version: string | null, revision: number) {
    if (version !== null && (await this.require(version)).releaseType !== "full") {
      throw new ApiError("只有全量版本可以设为最新版本", 409);
    }
    if (!await this.repo.setLatest(version, revision)) throw conflict();
    return { latestVersion: version, revision: revision + 1 };
  }
  async setSegments(version: string, revision: number, segmentIds: string[]) {
    if ((await this.require(version)).releaseType !== "gray") throw new ApiError("只有灰度版本可以配置人群", 409);
    if (!await this.repo.setSegments(version, revision, segmentIds, this.now().toISOString())) throw conflict();
    return this.require(version);
  }
  async resolve(userId?: string) {
    const settings = await this.repo.settings();
    let selected = settings.latestVersion;
    if (userId !== undefined) {
      const targets = await this.repo.targets();
      const segments = await this.segments.load(targets.flatMap((t) => t.segmentIds));
      const matched = new Set(segments.filter((s) => matchesMembers(s.members, { sso_id: userId })).map((s) => s.id));
      for (const target of targets) if (target.segmentIds.some((id) => matched.has(id))) selected = effectiveVersion(selected, target.version);
    }
    if (!selected) return { version: null };
    const value = await this.repo.get(selected);
    // A concurrent removal followed by deletion may invalidate an older read snapshot.
    if (!value) throw new ApiError("版本配置正在更新，请稍后重试", 503);
    const { version, releaseNotes, downloadUrl, downloadSizeBytes } = value;
    return { version: { version, releaseNotes, downloadUrl, downloadSizeBytes } };
  }
}
