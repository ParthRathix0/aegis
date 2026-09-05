import { describe, it, expect } from "vitest";
import { decideAction, BatchState } from "../src/decide";

const base: BatchState = { batchId: "1", phase: "OPEN", endBlock: 100, lastCollectBlock: 0 };

describe("decideAction", () => {
  it("waits during OPEN before endBlock", () => {
    expect(decideAction(base, 50)).toEqual({ kind: "wait" });
  });
  it("starts accumulation at OPEN endBlock", () => {
    expect(decideAction(base, 100)).toEqual({ kind: "startAccumulation" });
  });
  it("collects prices when interval elapsed in ACCUMULATING", () => {
    const s: BatchState = { ...base, phase: "ACCUMULATING", endBlock: 200, lastCollectBlock: 100 };
    expect(decideAction(s, 104)).toEqual({ kind: "collectOraclePrices" });
  });
  it("waits in ACCUMULATING before the collection interval elapses", () => {
    const s: BatchState = { ...base, phase: "ACCUMULATING", endBlock: 200, lastCollectBlock: 100 };
    expect(decideAction(s, 103)).toEqual({ kind: "wait" });
  });
  it("starts dispute at ACCUMULATING endBlock", () => {
    const s: BatchState = { ...base, phase: "ACCUMULATING", endBlock: 200, lastCollectBlock: 199 };
    expect(decideAction(s, 200)).toEqual({ kind: "startDispute" });
  });
  it("starts settling at DISPUTING endBlock", () => {
    const s: BatchState = { ...base, phase: "DISPUTING", endBlock: 250, lastCollectBlock: 0 };
    expect(decideAction(s, 250)).toEqual({ kind: "startSettling" });
  });
  it("waits during DISPUTING before endBlock", () => {
    const s: BatchState = { ...base, phase: "DISPUTING", endBlock: 250, lastCollectBlock: 0 };
    expect(decideAction(s, 249)).toEqual({ kind: "wait" });
  });
  it("executes settlement at SETTLING endBlock", () => {
    const s: BatchState = { ...base, phase: "SETTLING", endBlock: 300, lastCollectBlock: 0 };
    expect(decideAction(s, 300)).toEqual({ kind: "executeSettlement" });
  });
});
