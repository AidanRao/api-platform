import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../../../../src/features/ads/schema";
import { AdStatusBadge } from "./AdStatusBadge";
import { adStatus } from "./presentation";

const start = "2026-10-23T00:00:00.000Z";
const end = "2026-10-24T00:00:00.000Z";
const active = { enabled: true, startsAt: null, endsAt: null };
const now = Date.parse(start);
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("advertising list status", () => {
  it("gives disabled records precedence over schedules", () => {
    expect(adStatus({ ...active, enabled: false, endsAt: start }, now)).toBe("disabled");
    expect(adStatus(active, now, { ...active, enabled: false })).toBe("disabled");
  });
  it("includes the start boundary and excludes the end boundary", () => {
    const scheduled = { ...active, startsAt: start, endsAt: end };
    expect(adStatus(scheduled, now - 1)).toBe("scheduled");
    expect(adStatus(scheduled, now)).toBe("active");
    expect(adStatus(scheduled, Date.parse(end) - 1)).toBe("active");
    expect(adStatus(scheduled, Date.parse(end))).toBe("ended");
    expect(adStatus(active, now)).toBe("active");
  });
  it("uses the intersection of campaign and placement windows", () => {
    expect(adStatus(active, now, { ...active, startsAt: end })).toBe("scheduled");
    expect(adStatus(active, now, { ...active, endsAt: start })).toBe("ended");
    expect(adStatus({ ...active, startsAt: end }, now, { ...active, endsAt: start })).toBe("ended");
  });
  it("updates an open list at schedule boundaries without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now - 1_000);
    const campaign: Campaign = {
      ...active, startsAt: start, endsAt: end, id: "campaign", name: "活动", notes: "",
      revision: 1, createdAt: start, updatedAt: start,
    };
    render(<AdStatusBadge item={campaign} />);
    expect(screen.getByText("未开始")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("进行中")).toBeTruthy();
    act(() => vi.advanceTimersByTime(Date.parse(end) - now));
    expect(screen.getByText("已结束")).toBeTruthy();
  });
});
