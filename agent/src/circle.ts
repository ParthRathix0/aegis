import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { CrankAction } from "./decide";

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
