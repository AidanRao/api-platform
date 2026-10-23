type Schedule = {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export const adStatuses = {
  disabled: { label: "未启用", variant: "muted" },
  scheduled: { label: "未开始", variant: "info" },
  active: { label: "进行中", variant: "success" },
  ended: { label: "已结束", variant: "warning" },
} as const;

export function adWindow(item: Schedule, campaign?: Schedule) {
  const startsAt = Math.max(
    item.startsAt ? Date.parse(item.startsAt) : -Infinity,
    campaign?.startsAt ? Date.parse(campaign.startsAt) : -Infinity,
  );
  const endsAt = Math.min(
    item.endsAt ? Date.parse(item.endsAt) : Infinity,
    campaign?.endsAt ? Date.parse(campaign.endsAt) : Infinity,
  );
  return { startsAt, endsAt };
}

export function adStatus(item: Schedule, now: number, campaign?: Schedule): keyof typeof adStatuses {
  if (!item.enabled || (campaign && !campaign.enabled)) return "disabled";
  const { startsAt, endsAt } = adWindow(item, campaign);
  if (endsAt <= startsAt || now >= endsAt) return "ended";
  return now < startsAt ? "scheduled" : "active";
}
