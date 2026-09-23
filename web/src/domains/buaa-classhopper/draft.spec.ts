import { describe, expect, it } from "vitest";

import type { AccessPolicy } from "../../../../src/domains/buaa-classhopper/access-policy.schema";
import {
  buildPatch,
  createEmptyDraft,
  getDraftCounts,
  normalizeDraft,
  stageAddition,
  stageRemoval,
  undoRemoval,
} from "./draft";

const policy: AccessPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001", "ZY370002"],
  names: ["张三", "李四"],
};

describe("policy draft", () => {
  it("trims and stages additions without mutating inputs", () => {
    const draft = createEmptyDraft();
    const result = stageAddition(policy, draft, "studentIds", " 23370003 ");

    expect(result).toEqual({
      error: null,
      draft: {
        add: { studentIds: ["23370003"], names: [] },
        remove: { studentIds: [], names: [] },
      },
    });
    expect(draft).toEqual(createEmptyDraft());
    expect(policy.studentIds).toEqual(["23370001", "ZY370002"]);
  });

  it("reports existing and duplicate additions", () => {
    const existing = stageAddition(policy, createEmptyDraft(), "names", "张三");
    const first = stageAddition(policy, createEmptyDraft(), "names", "王五");
    const duplicate = stageAddition(policy, first.draft, "names", " 王五 ");

    expect(existing.error).toBe("该项已在白名单中");
    expect(duplicate.error).toBe("该项已在待新增列表中");
  });

  it("deleting a new item cancels it and adding a removed item undoes removal", () => {
    const added = stageAddition(policy, createEmptyDraft(), "names", "王五").draft;
    expect(stageRemoval(added, "names", "王五")).toEqual(createEmptyDraft());

    const removed = stageRemoval(createEmptyDraft(), "names", "张三");
    expect(stageAddition(policy, removed, "names", "张三")).toEqual({
      draft: createEmptyDraft(),
      error: null,
    });
  });

  it("stages and undoes a removal idempotently", () => {
    const once = stageRemoval(createEmptyDraft(), "studentIds", "23370001");
    const twice = stageRemoval(once, "studentIds", "23370001");

    expect(twice).toBe(once);
    expect(undoRemoval(twice, "studentIds", "23370001")).toEqual(
      createEmptyDraft(),
    );
  });

  it("recomputes effective changes against a newer policy", () => {
    const draft = {
      add: { studentIds: ["23370003"], names: ["王五"] },
      remove: { studentIds: ["23370001"], names: ["张三"] },
    };
    const latest = {
      ...policy,
      revision: "2026-09-10-002",
      studentIds: ["ZY370002", "23370003"],
    };

    expect(normalizeDraft(latest, draft)).toEqual({
      add: { studentIds: [], names: ["王五"] },
      remove: { studentIds: [], names: ["张三"] },
    });
    expect(draft.add.studentIds).toEqual(["23370003"]);
  });

  it("builds a compact PATCH body and returns null without effective changes", () => {
    const draft = {
      add: { studentIds: ["23370003"], names: [] },
      remove: { studentIds: [], names: ["张三"] },
    };

    expect(buildPatch(policy, draft)).toEqual({
      baseRevision: "2026-09-10-001",
      add: { studentIds: ["23370003"] },
      remove: { names: ["张三"] },
    });
    expect(buildPatch(policy, createEmptyDraft())).toBeNull();
    expect(getDraftCounts(draft)).toEqual({ added: 1, removed: 1, total: 2 });
  });
});
