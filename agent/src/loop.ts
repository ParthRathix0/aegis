import "dotenv/config";
import { ethers } from "ethers";
import { decideAction, BatchState, CrankAction } from "./decide";
import { fetchBatchPhase, phaseFromState } from "./subgraph";
import { executeCrank } from "./executor";
import { makeCircleClient, executeCrankViaCircle } from "./circle";

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

// A crank executor: maps a decided action to an onchain call, returning a tx
// hash / Circle tx id (or null for `wait`).
type Executor = (a: CrankAction) => Promise<string | null>;

async function tick(
  provider: ethers.Provider,
  readContract: ethers.Contract,
  execute: Executor,
  subgraphUrl: string | undefined,
): Promise<void> {
  const [batchId, stateRaw, endBlock] = await readContract.getCurrentBatchInfo();
  const lastCollect = await readContract.lastCollectionBlock();
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
  const ref = await execute(action);
  console.log(
    new Date().toISOString(),
    `batch=${state.batchId}`,
    phase,
    `block=${block}/${state.endBlock}`,
    action.kind,
    ref ?? "",
  );
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const aegisAddress = process.env.AEGIS_ADDRESS!;
  const readContract = new ethers.Contract(aegisAddress, ABI, provider);
  const subgraphUrl = process.env.SUBGRAPH_URL || undefined;

  // Writes go through the Circle Agent Stack wallet when configured (native
  // USDC settlement on Arc); otherwise a raw key signs (local/dev smoke tests).
  const useCircle = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_WALLET_ID);
  let execute: Executor;
  let signer: string;
  if (useCircle) {
    const sdk = makeCircleClient();
    const walletId = process.env.CIRCLE_WALLET_ID!;
    execute = (a) => executeCrankViaCircle(sdk, walletId, aegisAddress, a);
    signer = `circle:${process.env.CIRCLE_WALLET_ADDRESS ?? walletId}`;
  } else {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    const writeContract = readContract.connect(wallet) as ethers.Contract;
    execute = (a) => executeCrank(writeContract, a);
    signer = wallet.address;
  }

  console.log(
    `Aegis Solver Agent — aegis=${aegisAddress} signer=${signer} ` +
      `subgraph=${subgraphUrl ?? "(contract fallback)"}`,
  );

  for (;;) {
    try {
      await tick(provider, readContract, execute, subgraphUrl);
    } catch (e) {
      // Reverts (e.g. cranking too early against a lagged subgraph) are
      // expected and non-fatal — log and keep ticking.
      console.error("tick error", (e as Error).message ?? e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
