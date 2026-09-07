import { describe, it, expect, vi } from "vitest";
import { crankSignature, depositCallsForIntent, depositViaCircle } from "../src/circle";
import { CrankAction } from "../src/decide";

const assets = { aegis: "0xAE", usdc: "0xUS", weth: "0xWE" };

describe("depositCallsForIntent", () => {
  it("approves USDC then deposits a QUOTE payment as BUY (side 0)", () => {
    const calls = depositCallsForIntent({ payWith: "QUOTE", amount: 1_000_000n }, assets);
    expect(calls).toEqual([
      { contractAddress: "0xUS", abiFunctionSignature: "approve(address,uint256)", abiParameters: ["0xAE", "1000000"] },
      { contractAddress: "0xAE", abiFunctionSignature: "deposit(uint256,uint8)", abiParameters: ["1000000", "0"] },
    ]);
  });

  it("approves WETH then deposits a BASE payment as SELL (side 1)", () => {
    const calls = depositCallsForIntent({ payWith: "BASE", amount: 10n ** 18n }, assets);
    expect(calls[0].contractAddress).toBe("0xWE");
    expect(calls[0].abiParameters).toEqual(["0xAE", "1000000000000000000"]);
    expect(calls[1].abiParameters).toEqual(["1000000000000000000", "1"]);
  });

  it("propagates the positive-amount guard", () => {
    expect(() => depositCallsForIntent({ payWith: "QUOTE", amount: 0n }, assets)).toThrow(/positive/);
  });
});

describe("depositViaCircle", () => {
  it("executes each call via Circle in order and returns the tx ids", async () => {
    let n = 0;
    const sdk: any = {
      createContractExecutionTransaction: vi.fn(async () => ({ data: { id: `tx${++n}` } })),
    };
    const calls = depositCallsForIntent({ payWith: "QUOTE", amount: 5n }, assets);
    const ids = await depositViaCircle(sdk, "wallet-1", calls);
    expect(sdk.createContractExecutionTransaction).toHaveBeenCalledTimes(2);
    expect(sdk.createContractExecutionTransaction.mock.calls[0][0]).toMatchObject({
      walletId: "wallet-1",
      contractAddress: "0xUS",
      abiFunctionSignature: "approve(address,uint256)",
    });
    expect(ids).toEqual(["tx1", "tx2"]);
  });
});

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
