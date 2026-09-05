import { ethers } from "ethers";

// 1inch Aqua routing for the Solver Agent.
//
// After AegisV4 settles a batch, one side has an uncrossed (over-supplied) remainder. The agent
// fetches an Aqua/SwapVM quote for that remainder, derives an onchain minOut floor, and calls
// AegisV4.routeUncrossedToAqua(batchId, minOut, aquaCalldata). The contract forwards the calldata
// (built here) to the official 1inch Aqua/SwapVM entrypoint via AquaRouter, so the uncrossed side is
// filled at market instead of merely refunded its deposit.
//
// NOTE (fetch live): the exact Aqua endpoint/SDK method + the SwapVM router address are fetched from
// the live 1inch Aqua docs at run time (see AquaRouter.sol header). fetchAquaQuote targets the 1inch
// swap API shape and is dependency-injected (fetchImpl) so it is unit-testable without a live key.

export interface AquaQuote {
  toAmount: bigint; // expected counter-asset out for the uncrossed remainder
  txData: string; // ABI-encoded SwapVM swap(...) calldata forwarded through AquaRouter
}

export interface AquaQuoteParams {
  chainId: number;
  src: string; // tokenIn — the uncrossed side's deposit asset
  dst: string; // tokenOut — the counter-asset
  amount: bigint; // uncrossed remainder amount
  from: string; // the AquaRouter address (executes + receives the swap)
}

// Derive the onchain minOut slippage floor from an Aqua quote (slippageBps in basis points).
export function minOutFromQuote(toAmount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10000) throw new Error("slippageBps out of range");
  return (toAmount * BigInt(10000 - slippageBps)) / 10000n;
}

// Fetch an Aqua/SwapVM quote + swap calldata for the uncrossed remainder. fetchImpl defaults to the
// global fetch; tests inject a stub. Bearer auth uses ONEINCH_API_KEY (user-provided).
export async function fetchAquaQuote(
  p: AquaQuoteParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AquaQuote> {
  const qs = new URLSearchParams({
    src: p.src,
    dst: p.dst,
    amount: p.amount.toString(),
    from: p.from,
    slippage: "1",
    disableEstimate: "true",
  });
  const url = `https://api.1inch.dev/swap/v6.0/${p.chainId}/swap?${qs.toString()}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`1inch Aqua API error ${res.status}`);
  const j: any = await res.json();
  const toAmount = BigInt(j.dstAmount ?? j.toAmount);
  const txData: string = j.tx?.data ?? j.data;
  return { toAmount, txData };
}

// Thin onchain call: route a settled batch's uncrossed remainder to Aqua. Returns the tx hash.
export async function executeAquaRoute(
  aegis: ethers.Contract,
  batchId: number,
  minOut: bigint,
  aquaCalldata: string,
): Promise<string | null> {
  const tx = await aegis.routeUncrossedToAqua(batchId, minOut, aquaCalldata);
  return (await tx.wait())?.hash ?? null;
}

export interface AquaConfig {
  chainId: number;
  aquaRouter: string; // deployed AquaRouter address (spender/receiver)
  apiKey: string; // ONEINCH_API_KEY
  slippageBps: number; // onchain minOut floor tolerance
  baseAsset: string;
  quoteAsset: string;
}

// Orchestrator wired into the tick loop after a batch settles: read the uncrossed remainder, and if
// any, fetch an Aqua quote for it and route it onchain. No-ops (returns null) when fully crossed.
export async function routeUncrossedIfConfigured(
  aegis: ethers.Contract,
  batchId: number,
  cfg: AquaConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const [sideBuy, amountIn]: [boolean, bigint] = await aegis.getUncrossedRemainder(batchId);
  if (amountIn === 0n) return null;

  // Buy side over-supplied quote -> sell QUOTE for BASE; sell side over-supplied base -> BASE for QUOTE.
  const [src, dst] = sideBuy ? [cfg.quoteAsset, cfg.baseAsset] : [cfg.baseAsset, cfg.quoteAsset];
  const quote = await fetchAquaQuote(
    { chainId: cfg.chainId, src, dst, amount: amountIn, from: cfg.aquaRouter },
    cfg.apiKey,
    fetchImpl,
  );
  const minOut = minOutFromQuote(quote.toAmount, cfg.slippageBps);
  return executeAquaRoute(aegis, batchId, minOut, quote.txData);
}
