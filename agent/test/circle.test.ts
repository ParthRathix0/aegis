import { describe, it, expect } from "vitest";
import { crankSignature } from "../src/circle";
import { CrankAction } from "../src/decide";

describe("crankSignature", () => {
  it("returns null for wait", () => {
    expect(crankSignature({ kind: "wait" })).toBeNull();
  });

  const cases: [CrankAction["kind"], string][] = [
    ["startAccumulation", "startAccumulation()"],
    ["collectOraclePrices", "collectOraclePrices()"],
    ["startDispute", "startDispute()"],
    ["startSettling", "startSettling()"],
    ["executeSettlement", "executeSettlement()"],
  ];

  for (const [kind, sig] of cases) {
    it(`maps ${kind} to ${sig}`, () => {
      expect(crankSignature({ kind } as CrankAction)).toBe(sig);
    });
  }
});
