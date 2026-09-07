import { describe, it, expect } from "vitest";
import { intentToOrder, AgentPaymentIntent } from "../src/paymentIntent";

describe("intentToOrder", () => {
  it("maps a QUOTE (USDC) payment to a BUY order for BASE", () => {
    const intent: AgentPaymentIntent = { payWith: "QUOTE", amount: 1_000_000n };
    expect(intentToOrder(intent)).toEqual({ amount: 1_000_000n, side: "BUY" });
  });

  it("maps a BASE (WETH) payment to a SELL order for QUOTE", () => {
    const intent: AgentPaymentIntent = { payWith: "BASE", amount: 10n ** 18n };
    expect(intentToOrder(intent)).toEqual({ amount: 10n ** 18n, side: "SELL" });
  });

  it("rejects a non-positive payment amount", () => {
    expect(() => intentToOrder({ payWith: "QUOTE", amount: 0n })).toThrow(/positive/);
    expect(() => intentToOrder({ payWith: "BASE", amount: -1n })).toThrow(/positive/);
  });
});
