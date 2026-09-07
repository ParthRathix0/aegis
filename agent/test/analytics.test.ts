import { describe, it, expect } from "vitest";
import { computeReliability, reliableOracleCount, isSettlementSafe } from "../src/analytics";

const obs = [
  { oracleId: "1", isValid: true },
  { oracleId: "1", isValid: true },
  { oracleId: "1", isValid: true },
  { oracleId: "2", isValid: false }, // Pyth: always reverting
  { oracleId: "2", isValid: false },
  { oracleId: "3", isValid: true },
  { oracleId: "3", isValid: false }, // API3: intermittently stale
];

describe("computeReliability", () => {
  it("aggregates valid/total per oracle into a reliability rate", () => {
    const r = computeReliability(obs);
    expect(r.find((x) => x.oracleId === "1")).toEqual({ oracleId: "1", total: 3, valid: 3, rate: 1 });
    expect(r.find((x) => x.oracleId === "2")).toEqual({ oracleId: "2", total: 2, valid: 0, rate: 0 });
    expect(r.find((x) => x.oracleId === "3")).toEqual({ oracleId: "3", total: 2, valid: 1, rate: 0.5 });
  });
});

describe("reliableOracleCount", () => {
  it("counts oracles at or above the min reliability rate", () => {
    const r = computeReliability(obs);
    expect(reliableOracleCount(r, 0.5)).toBe(2); // oracle 1 (1.0) + oracle 3 (0.5)
    expect(reliableOracleCount(r, 0.9)).toBe(1); // only oracle 1
  });
});

describe("isSettlementSafe", () => {
  it("is true when >=2 oracles clear the reliability bar (settlement won't void)", () => {
    expect(isSettlementSafe(computeReliability(obs), 2, 0.5)).toBe(true);
  });
  it("is false when fewer than 2 oracles are reliable (would void)", () => {
    const onlyChainlink = [
      { oracleId: "1", isValid: true },
      { oracleId: "2", isValid: false },
      { oracleId: "3", isValid: false },
    ];
    expect(isSettlementSafe(computeReliability(onlyChainlink), 2, 0.5)).toBe(false);
  });
});
