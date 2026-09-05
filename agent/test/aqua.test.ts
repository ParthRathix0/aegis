import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";
import {
  minOutFromQuote,
  fetchAquaQuote,
  executeAquaRoute,
  routeUncrossedIfConfigured,
} from "../src/aqua";

describe("minOutFromQuote", () => {
  it("applies slippage tolerance in bps", () => {
    expect(minOutFromQuote(1_000_000n, 100)).toBe(990_000n); // 1% slippage
    expect(minOutFromQuote(1_000_000n, 0)).toBe(1_000_000n); // no slippage
    expect(minOutFromQuote(2000n * 10n ** 6n, 50)).toBe((2000n * 10n ** 6n * 9950n) / 10000n);
  });

  it("rejects out-of-range slippage", () => {
    expect(() => minOutFromQuote(1n, -1)).toThrow();
    expect(() => minOutFromQuote(1n, 10001)).toThrow();
  });
});

describe("fetchAquaQuote", () => {
  it("requests the Aqua/SwapVM quote and maps the response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dstAmount: "1990000", tx: { to: "0xrouter", data: "0xdeadbeef" } }),
    })) as any;

    const q = await fetchAquaQuote(
      { chainId: 1, src: "0xIn", dst: "0xOut", amount: 1n * 10n ** 18n, from: "0xAquaRouter" },
      "TESTKEY",
      fetchImpl,
    );

    expect(q.toAmount).toBe(1_990_000n);
    expect(q.txData).toBe("0xdeadbeef");
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain("/swap/v6.0/1/swap");
    expect(url).toContain("amount=1000000000000000000");
    expect(url).toContain("from=0xAquaRouter");
    expect(opts.headers.Authorization).toBe("Bearer TESTKEY");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any;
    await expect(
      fetchAquaQuote({ chainId: 1, src: "0xIn", dst: "0xOut", amount: 1n, from: "0xR" }, "K", fetchImpl),
    ).rejects.toThrow(/401/);
  });
});

describe("executeAquaRoute", () => {
  it("calls routeUncrossedToAqua with the batch id, minOut, and calldata; returns tx hash", async () => {
    const routeUncrossedToAqua = vi.fn(async () => ({ wait: async () => ({ hash: "0xrouted" }) }));
    const c = { routeUncrossedToAqua } as unknown as ethers.Contract;

    const hash = await executeAquaRoute(c, 7, 990_000n, "0xcalldata");
    expect(routeUncrossedToAqua).toHaveBeenCalledWith(7, 990_000n, "0xcalldata");
    expect(hash).toBe("0xrouted");
  });
});

describe("routeUncrossedIfConfigured", () => {
  const cfg = {
    chainId: 1,
    aquaRouter: "0xAquaRouter",
    apiKey: "K",
    slippageBps: 100,
    baseAsset: "0xBASE",
    quoteAsset: "0xQUOTE",
  };

  it("no-ops when there is no uncrossed remainder", async () => {
    const aegis = {
      getUncrossedRemainder: vi.fn(async () => [false, 0n]),
      routeUncrossedToAqua: vi.fn(),
    } as any;
    const fetchImpl = vi.fn();
    const res = await routeUncrossedIfConfigured(aegis, 3, cfg, fetchImpl as any);
    expect(res).toBeNull();
    expect(aegis.routeUncrossedToAqua).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes a SELL remainder (base->quote) with a slippage-adjusted minOut", async () => {
    const uncrossedBase = 1n * 10n ** 18n;
    const aegis = {
      getUncrossedRemainder: vi.fn(async () => [false, uncrossedBase]),
      routeUncrossedToAqua: vi.fn(async () => ({ wait: async () => ({ hash: "0xok" }) })),
    } as any;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dstAmount: "2000000000", tx: { data: "0xcafe" } }),
    })) as any;

    const res = await routeUncrossedIfConfigured(aegis, 5, cfg, fetchImpl);

    // SELL side -> src=base, dst=quote.
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("src=0xBASE");
    expect(url).toContain("dst=0xQUOTE");
    expect(url).toContain("amount=1000000000000000000");
    // minOut = 2,000,000,000 * (10000-100)/10000 = 1,980,000,000
    expect(aegis.routeUncrossedToAqua).toHaveBeenCalledWith(5, 1_980_000_000n, "0xcafe");
    expect(res).toBe("0xok");
  });

  it("routes a BUY remainder as quote->base", async () => {
    const aegis = {
      getUncrossedRemainder: vi.fn(async () => [true, 500_000_000n]),
      routeUncrossedToAqua: vi.fn(async () => ({ wait: async () => ({ hash: "0xok2" }) })),
    } as any;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dstAmount: "250000000000000000", tx: { data: "0xbeef" } }),
    })) as any;

    await routeUncrossedIfConfigured(aegis, 9, cfg, fetchImpl);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("src=0xQUOTE"); // BUY over-supply -> sell quote for base
    expect(url).toContain("dst=0xBASE");
  });
});
