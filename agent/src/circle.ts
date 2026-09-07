import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { CrankAction } from "./decide";
import { AgentPaymentIntent, intentToOrder } from "./paymentIntent";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

// All AegisV4 crank functions are zero-arg, so an action maps directly to a
// Solidity function signature. Pure — no I/O — so it is unit-tested. `wait`
// maps to null (nothing to execute).
export function crankSignature(a: CrankAction): string | null {
  switch (a.kind) {
    case "wait":
      return null;
    case "startAccumulation":
      return "startAccumulation()";
    case "collectOraclePrices":
      return "collectOraclePrices()";
    case "startDispute":
      return "startDispute()";
    case "startSettling":
      return "startSettling()";
    case "executeSettlement":
      return "executeSettlement()";
  }
}

// A single Circle contract-execution call (approve or deposit).
export interface CircleCall {
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: string[];
}

// Token addresses the two-asset batch settles in.
export interface DepositAssets {
  aegis: string;
  usdc: string; // quote (BUY spends this)
  weth: string; // base  (SELL spends this)
}

// Pure: the ordered Circle calls to submit a payment intent as an Aegis deposit —
// first approve the spent asset to Aegis, then deposit(amount, side). Spending
// QUOTE (USDC) is a BUY (side 0); spending BASE (WETH) is a SELL (side 1). uint256
// values are stringified (Circle abiParameters are strings; bigint isn't JSON-safe).
export function depositCallsForIntent(intent: AgentPaymentIntent, assets: DepositAssets): CircleCall[] {
  const order = intentToOrder(intent);
  const token = intent.payWith === "QUOTE" ? assets.usdc : assets.weth;
  const sideCode = order.side === "BUY" ? "0" : "1";
  const amount = order.amount.toString();
  return [
    { contractAddress: token, abiFunctionSignature: "approve(address,uint256)", abiParameters: [assets.aegis, amount] },
    { contractAddress: assets.aegis, abiFunctionSignature: "deposit(uint256,uint8)", abiParameters: [amount, sideCode] },
  ];
}

// Executes the given Circle calls sequentially via the developer-controlled
// wallet, returning each Circle transaction id. Callers that need on-chain
// ordering (approve must confirm before deposit) should await confirmation
// between calls via getTransaction.
export async function depositViaCircle(
  sdk: CircleClient,
  walletId: string,
  calls: CircleCall[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const call of calls) {
    const res = await sdk.createContractExecutionTransaction({
      walletId,
      contractAddress: call.contractAddress,
      abiFunctionSignature: call.abiFunctionSignature,
      abiParameters: call.abiParameters,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    ids.push(res.data?.id ?? "");
  }
  return ids;
}

// Builds the Circle Agent Stack (developer-controlled wallets) client from env.
// The wallet signs + broadcasts onchain, so the agent settles as a Circle
// agent-controlled wallet (native USDC on Arc) — the Arc submission artifact.
export function makeCircleClient(): CircleClient {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for Circle mode");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

// Executes a crank action via the Circle wallet. Circle signs and broadcasts;
// the returned value is the Circle transaction id (poll getTransaction for the
// onchain hash). Returns null for `wait`.
export async function executeCrankViaCircle(
  sdk: CircleClient,
  walletId: string,
  contractAddress: string,
  a: CrankAction,
): Promise<string | null> {
  const sig = crankSignature(a);
  if (!sig) return null;
  const res = await sdk.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature: sig,
    abiParameters: [],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  return res.data?.id ?? null;
}
