import { ApiError } from "../../http/errors";
import { validatePlatformImage } from "../../infrastructure/image-url";
import { AdsRepository } from "./repository";
import {
  campaignPatchSchema,
  creativePatchSchema,
  slotPatchSchema,
  placementPatchSchema,
  type CampaignInput,
  type CreativeInput,
  type SlotInput,
  type PlacementInput,
  type Placement,
} from "./schema";
import type { z } from "zod";

export function requireRecord<T>(value: T | null, label = "广告记录"): T {
  if (value === null) throw new ApiError(`${label}不存在`, 404);
  return value;
}
function checkRevision(value: { revision: number }, revision: number) {
  if (value.revision !== revision)
    throw new ApiError("记录已被修改，请核对最新内容后重试", 409, {
      currentRevision: value.revision,
    });
}
function schedule(value: { startsAt: string | null; endsAt: string | null }) {
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt)
    throw new ApiError("结束时间必须晚于开始时间", 400);
}
function slotLimit(format: string, maxItems: number) {
  if (format !== "carousel" && maxItems !== 1)
    throw new ApiError("非轮播广告位只能返回一条广告", 400);
}
export class AdsService {
  constructor(
    readonly repo: AdsRepository,
    private readonly env: Env,
    private readonly now: () => Date,
  ) {}
  private async changed<T extends { revision: number }>(
    result: T | null,
    read: () => Promise<T | null>,
  ): Promise<T> {
    if (result) return result;
    const latest = requireRecord(await read());
    throw new ApiError("记录已被修改，请核对最新内容后重试", 409, {
      currentRevision: latest.revision,
    });
  }
  async createCampaign(input: CampaignInput) {
    schedule(input);
    return this.repo.createCampaign(input, this.now().toISOString());
  }
  async updateCampaign(id: string, input: z.infer<typeof campaignPatchSchema>) {
    const current = requireRecord(await this.repo.campaign(id));
    checkRevision(current, input.revision);
    const next = { ...current, ...input };
    schedule(next);
    return this.changed(
      await this.repo.updateCampaign(next, this.now().toISOString()),
      () => this.repo.campaign(id),
    );
  }
  async createCreative(input: CreativeInput) {
    validatePlatformImage(this.env, input.draft.imageUrl);
    return this.repo.createCreative(input, this.now().toISOString());
  }
  async updateCreative(id: string, input: z.infer<typeof creativePatchSchema>) {
    const current = requireRecord(await this.repo.creative(id));
    checkRevision(current, input.revision);
    validatePlatformImage(this.env, input.draft?.imageUrl);
    return this.changed(
      await this.repo.updateCreative(
        { ...current, ...input },
        this.now().toISOString(),
      ),
      () => this.repo.creative(id),
    );
  }
  async publishCreative(id: string, revision: number) {
    const current = requireRecord(await this.repo.creative(id));
    checkRevision(current, revision);
    if (
      !current.draft.imageUrl ||
      (current.type === "card" && !current.draft.title)
    )
      throw new ApiError("发布需要图片，图文卡片还需要标题", 400);
    validatePlatformImage(this.env, current.draft.imageUrl);
    return this.changed(
      await this.repo.publishCreative(id, revision, this.now().toISOString()),
      () => this.repo.creative(id),
    );
  }
  async createSlot(appId: string, input: SlotInput) {
    const next = {
      ...input,
      maxItems: input.maxItems ?? (input.format === "carousel" ? 5 : 1),
    };
    slotLimit(next.format, next.maxItems);
    const value = await this.repo.createSlot(
      appId,
      next,
      this.now().toISOString(),
    );
    if (!value) throw new ApiError("广告位标识已存在", 409);
    return value;
  }
  async updateSlot(
    appId: string,
    key: string,
    input: z.infer<typeof slotPatchSchema>,
  ) {
    const current = requireRecord(await this.repo.slot(appId, key));
    checkRevision(current, input.revision);
    const next = { ...current, ...input };
    slotLimit(next.format, next.maxItems);
    return this.changed(
      await this.repo.updateSlot(next, this.now().toISOString()),
      () => this.repo.slot(appId, key),
    );
  }
  private async validatePlacement(appId: string, input: PlacementInput) {
    schedule(input);
    const [activity, adSlot, material] = await Promise.all([
      this.repo.campaign(input.campaignId),
      this.repo.slot(appId, input.slotKey),
      this.repo.creative(input.creativeId),
    ]);
    requireRecord(activity, "活动");
    const slot = requireRecord(adSlot, "广告位");
    const creative = requireRecord(material, "素材");
    if ((slot.format === "card" ? "card" : "image") !== creative.type)
      throw new ApiError("素材类型与广告位不匹配", 400);
    if (input.enabled && creative.publishedVersion === null)
      throw new ApiError("启用投放前请先发布素材", 400);
  }
  async createPlacement(appId: string, input: PlacementInput) {
    await this.validatePlacement(appId, input);
    const value = await this.repo.createPlacement(
      appId,
      input,
      this.now().toISOString(),
    );
    if (!value)
      throw new ApiError("关联记录已变化，请重新检查活动、广告位和素材", 409);
    return value;
  }
  async updatePlacement(
    appId: string,
    id: string,
    input: z.infer<typeof placementPatchSchema>,
  ) {
    const current = requireRecord(await this.repo.placement(appId, id));
    checkRevision(current, input.revision);
    const next: Placement = { ...current, ...input };
    await this.validatePlacement(appId, next);
    return this.changed(
      await this.repo.updatePlacement(next, this.now().toISOString()),
      () => this.repo.placement(appId, id),
    );
  }
  async deleteCampaign(id: string, revision: number) {
    checkRevision(requireRecord(await this.repo.campaign(id)), revision);
    if (!(await this.repo.deleteCampaign(id, revision)))
      throw new ApiError("无法删除：记录已变化或活动仍有投放", 409);
  }
  async deleteCreative(id: string, revision: number) {
    checkRevision(requireRecord(await this.repo.creative(id)), revision);
    if (!(await this.repo.deleteCreative(id, revision)))
      throw new ApiError("无法删除：素材已发布、被引用或记录已变化", 409);
  }
  async deleteSlot(appId: string, key: string, revision: number) {
    checkRevision(requireRecord(await this.repo.slot(appId, key)), revision);
    if (!(await this.repo.deleteSlot(appId, key, revision)))
      throw new ApiError("无法删除：广告位仍有投放或记录已变化", 409);
  }
  async deletePlacement(appId: string, id: string, revision: number) {
    checkRevision(
      requireRecord(await this.repo.placement(appId, id)),
      revision,
    );
    if (!(await this.repo.deletePlacement(appId, id, revision)))
      throw new ApiError("记录已变化，请刷新后重试", 409);
  }
}
