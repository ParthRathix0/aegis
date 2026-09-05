import "dotenv/config";
import { ethers } from "ethers";
import { decideAction, BatchState } from "./decide";
import { fetchBatchPhase, phaseFromState } from "./subgraph";
import { executeCrank } from "./executor";

// Minimal AegisV4 surface the agent needs: one view for the current batch
// (id, state, endBlock, ...), the collection-block view, and the five
// permissionless crank functions.
const ABI = [
  "function getCurrentBatchInfo() view returns (uint256,uint8,uint256,uint256,uint256,uint256)",
  "function lastCollectionBlock() view returns (uint256)",
  "function startAccumulation()",
  "function collectOraclePrices()",
  "function startDispute()",
  "function startSettling()",
  "function executeSettlement()",
];

const TICK_MS = Number(process.env.TICK_MS ?? 12_000); // ~1 block

async function tick(
  provider: ethers.Provider,
  c: ethers.Contract,
  subgraphUrl: string | undefined,
): Promise<void> {
  const [batchId, stateRaw, endBlock] = await c.getCurrentBatchInfo();
  const lastCollect = await c.lastCollectionBlock();
  const block = await provider.getBlockNumber();

  // The subgraph is the agent's phase source (The Graph — load-bearing). When
  // no subgraph is configured (local smoke tests) fall back to the contract's
  // authoritative state field so the crank still runs end-to-end.
  const phase = subgraphUrl
    ? await fetchBatchPhase(subgraphUrl, batchId.toString())
    : phaseFromState(Number(stateRaw));

  const state: BatchState = {
    batchId: batchId.toString(),
    phase,
    endBlock: Number(endBlock),
    lastCollectBlock: Number(lastCollect),
  };

  const action = decideAction(state, block);
  const hash = await executeCrank(c, action);
  console.log(
    new Date().toISOString(),
    `batch=${state.batchId}`,
    phase,
    `block=${block}/${state.endBlock}`,
    action.kind,
    hash ?? "",
  );
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const c = new ethers.Contract(process.env.AEGIS_ADDRESS!, ABI, wallet);
  const subgraphUrl = process.env.SUBGRAPH_URL || undefined;

  console.log(
    `Aegis Solver Agent — aegis=${process.env.AEGIS_ADDRESS} signer=${wallet.address} ` +
      `subgraph=${subgraphUrl ?? "(contract fallback)"}`,
  );

  for (;;) {
    try {
      await tick(provider, c, subgraphUrl);
    } catch (e) {
      // Reverts (e.g. cranking too early against a lagged subgraph) are
      // expected and non-fatal — log and keep ticking.
      console.error("tick error", (e as Error).message ?? e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
