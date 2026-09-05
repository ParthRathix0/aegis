import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";
import { executeCrank } from "../src/executor";
import { CrankAction } from "../src/decide";

// A fake contract whose crank methods resolve to a tx object with a wait()
// returning a receipt carrying a deterministic hash. Lets us assert the
// executor calls the right function per action without any network.
function fakeContract() {
  const calls: string[] = [];
  const make = (name: string) =>
    vi.fn(async () => ({
      wait: async () => ({ hash: `0x${name}` }),
    }));
  const c: any = {
    calls,
    startAccumulation: make("acc"),
    collectOraclePrices: make("collect"),
    startDispute: make("dispute"),
    startSettling: make("settle"),
    executeSettlement: make("exec"),
  };
  return c as ethers.Contract & { calls: string[] };
}

describe("executeCrank", () => {
  it("returns null and calls nothing for wait", async () => {
    const c = fakeContract();
    const hash = await executeCrank(c, { kind: "wait" });
    expect(hash).toBeNull();
    expect((c as any).startAccumulation).not.toHaveBeenCalled();
  });

  const cases: [CrankAction["kind"], string, string][] = [
    ["startAccumulation", "startAccumulation", "0xacc"],
    ["collectOraclePrices", "collectOraclePrices", "0xcollect"],
    ["startDispute", "startDispute", "0xdispute"],
    ["startSettling", "startSettling", "0xsettle"],
    ["executeSettlement", "executeSettlement", "0xexec"],
  ];

  for (const [kind, method, expectedHash] of cases) {
    it(`calls ${method} and returns its tx hash for ${kind}`, async () => {
      const c = fakeContract();
      const hash = await executeCrank(c, { kind } as CrankAction);
      expect((c as any)[method]).toHaveBeenCalledOnce();
      expect(hash).toBe(expectedHash);
    });
  }
});
