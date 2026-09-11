import { describe, expect, it } from "vitest";

import type {
  AccessPolicy,
  AccessPolicyPatch,
} from "../src/domains/buaa-classhopper/access-policy.schema";
import {
  AccessPolicyMutationError,
  applyAccessPolicyPatch,
  nextRevision,
  RevisionConflictError,
} from "../src/domains/buaa-classhopper/access-policy.service";

const now = new Date("2026-09-10T04:00:00.000Z");
const policy: AccessPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001", "ZY370002"],
  names: ["张三", "李四"],
};

describe("access policy service", () => {
  it("applies removals first and appends effective additions in request order", () => {
    const snapshot = structuredClone(policy);
    const patch: AccessPolicyPatch = {
      baseRevision: policy.revision,
      add: {
        studentIds: ["ZY370002", "23370003", "23370004"],
        names: ["王五"],
      },
      remove: {
        studentIds: ["23370001"],
        names: ["不存在"],
      },
    };

    const result = applyAccessPolicyPatch(policy, patch, now);

    expect(result).toEqual({
      policy: {
        schemaVersion: 1,
        revision: "2026-09-10-002",
        studentIds: ["ZY370002", "23370003", "23370004"],
        names: ["张三", "李四", "王五"],
      },
      previousRevision: "2026-09-10-001",
      changed: true,
      changes: { added: 3, removed: 1 },
    });
    expect(policy).toEqual(snapshot);
  });

  it("keeps revision and object unchanged for a fully idempotent patch", () => {
    const result = applyAccessPolicyPatch(
      policy,
      {
        baseRevision: policy.revision,
        add: { studentIds: ["23370001"] },
        remove: { names: ["不存在"] },
      },
      now,
    );

    expect(result.changed).toBe(false);
    expect(result.policy).toBe(policy);
    expect(result.policy.revision).toBe("2026-09-10-001");
  });

  it("rejects a stale base revision", () => {
    expect(() =>
      applyAccessPolicyPatch(
        policy,
        { baseRevision: "2026-09-09-999", add: { names: ["王五"] } },
        now,
      ),
    ).toThrow(RevisionConflictError);
  });

  it("rejects a mutation whose final policy exceeds its list limit", () => {
    const fullPolicy: AccessPolicy = {
      ...policy,
      studentIds: Array.from({ length: 500 }, (_, index) => `${index}`),
    };

    expect(() =>
      applyAccessPolicyPatch(
        fullPolicy,
        {
          baseRevision: fullPolicy.revision,
          add: { studentIds: ["new-student"] },
        },
        now,
      ),
    ).toThrow(AccessPolicyMutationError);
  });

  it.each([
    ["same Shanghai date", "2026-09-10-001", "2026-09-10-002"],
    ["new Shanghai date", "2026-09-09-099", "2026-09-10-001"],
    ["version above 999", "2026-09-10-999", "2026-09-10-1000"],
  ])("generates revision for %s", (_case, current, expected) => {
    expect(nextRevision(current, now)).toBe(expected);
  });

  it("uses Asia/Shanghai for the date boundary", () => {
    expect(
      nextRevision(
        "2026-09-09-009",
        new Date("2026-09-09T16:00:00.000Z"),
      ),
    ).toBe("2026-09-10-001");
  });

  it("rejects a current revision dated in the future", () => {
    expect(() => nextRevision("2026-09-11-001", now)).toThrow(
      "revision date is in the future",
    );
  });
});
