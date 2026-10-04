import { describe, expect, expectTypeOf, it } from "vitest";

import {
  accessPolicyPatchSchema,
  accessPolicySchema,
  type AccessPolicy,
  type AccessPolicyPatch,
} from "../src/domains/buaa-classhopper/access-policy/schema";

const validPolicy = {
  schemaVersion: 1,
  revision: "2026-09-10-001",
  studentIds: ["23370001"],
  names: ["张三"],
} as const;

describe("access policy schema", () => {
  it("trims values and infers the stored contract type", () => {
    const result = accessPolicySchema.parse({
      ...validPolicy,
      revision: " 2026-09-10-001 ",
      studentIds: [" 23370001 "],
      names: [" 张三 "],
    });

    expect(result).toEqual(validPolicy);
    expectTypeOf(result).toEqualTypeOf<AccessPolicy>();
  });

  it.each([
    ["unknown field", { ...validPolicy, extra: true }],
    ["invalid revision format", { ...validPolicy, revision: "revision-1" }],
    ["invalid revision date", { ...validPolicy, revision: "2026-02-30-001" }],
    ["zero revision number", { ...validPolicy, revision: "2026-09-10-000" }],
    [
      "too many entries",
      {
        ...validPolicy,
        studentIds: Array.from({ length: 501 }, (_, index) => `${index}`),
      },
    ],
    ["duplicate normalized entries", { ...validPolicy, names: ["张三", " 张三 "] }],
  ])("rejects stored policy with %s", (_case, value) => {
    expect(accessPolicySchema.safeParse(value).success).toBe(false);
  });
});

describe("access policy patch schema", () => {
  it("trims patch values and infers the request type", () => {
    const result = accessPolicyPatchSchema.parse({
      baseRevision: " 2026-09-10-001 ",
      add: { studentIds: [" 23370002 "], names: [" 李四 "] },
    });

    expect(result).toEqual({
      baseRevision: "2026-09-10-001",
      add: { studentIds: ["23370002"], names: ["李四"] },
    });
    expectTypeOf(result).toEqualTypeOf<AccessPolicyPatch>();
  });

  it.each([
    ["missing operations", { baseRevision: "2026-09-10-001" }],
    [
      "empty operations",
      { baseRevision: "2026-09-10-001", add: { studentIds: [] } },
    ],
    [
      "unknown root field",
      { baseRevision: "2026-09-10-001", add: { names: ["李四"] }, extra: true },
    ],
    [
      "unknown nested field",
      {
        baseRevision: "2026-09-10-001",
        add: { names: ["李四"], unknown: [] },
      },
    ],
    [
      "normalized duplicates",
      {
        baseRevision: "2026-09-10-001",
        add: { names: ["李四", " 李四 "] },
      },
    ],
    [
      "add/remove overlap",
      {
        baseRevision: "2026-09-10-001",
        add: { studentIds: [" 23370002 "] },
        remove: { studentIds: ["23370002"] },
      },
    ],
    [
      "invalid base revision",
      { baseRevision: "2026-09-10-1", add: { names: ["李四"] } },
    ],
    [
      "array overflow",
      {
        baseRevision: "2026-09-10-001",
        remove: {
          names: Array.from({ length: 501 }, (_, index) => `name-${index}`),
        },
      },
    ],
  ])("rejects %s", (_case, value) => {
    expect(accessPolicyPatchSchema.safeParse(value).success).toBe(false);
  });
});
