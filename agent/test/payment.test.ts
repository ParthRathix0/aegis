import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";
import { submitPaymentIntent } from "../src/payment";

// A fake AegisV4 write contract whose deposit() resolves to a tx with a wait()
// returning a receipt with a deterministic hash — lets us assert the mapped
// (amount, side) without any network.
function fakeContract() {
  return {
    deposit: vi.fn(async () => ({ wait: async () => ({ hash: "0xdep" }) })),
  } as unknown as ethers.Contract & { deposit: ReturnType<typeof vi.fn> };
}

describe("submitPaymentIntent", () => {
  it("deposits a QUOTE (USDC) payment as a BUY (side=0)", async () => {
    const c = fakeContract();
    const hash = await submitPaymentIntent(c, { payWith: "QUOTE", amount: 1_000_000n });
    expect((c as any).deposit).toHaveBeenCalledWith(1_000_000n, 0);
    expect(hash).toBe("0xdep");
  });

  it("deposits a BASE (WETH) payment as a SELL (side=1)", async () => {
    const c = fakeContract();
    const hash = await submitPaymentIntent(c, { payWith: "BASE", amount: 10n ** 18n });
    expect((c as any).deposit).toHaveBeenCalledWith(10n ** 18n, 1);
    expect(hash).toBe("0xdep");
  });

  it("propagates the positive-amount guard and never deposits", async () => {
    const c = fakeContract();
    await expect(submitPaymentIntent(c, { payWith: "QUOTE", amount: 0n })).rejects.toThrow(/positive/);
    expect((c as any).deposit).not.toHaveBeenCalled();
  });
});
