import "dotenv/config";
import { ethers } from "ethers";
import { decideAction, BatchState, CrankAction } from "./decide";
import { fetchBatchPhase, phaseFromState } from "./subgraph";
import { executeCrank } from "./executor";
import { makeCircleClient, executeCrankViaCircle } from "./circle";
import { routeUncrossedIfConfigured, AquaConfig } from "./aqua";

// Minimal AegisV4 surface the agent needs: one view for the current batch
// (id, state, endBlock, ...), the collection-block view, the five
// permissionless crank functions, and the 1inch Aqua routing surface.
const ABI = [
  "function getCurrentBatchInfo() view returns (uint256,uint8,uint256,uint256,uint256,uint256)",
  "function lastCollectionBlock() view returns (uint256)",
  "function startAccumulation()",
  "function collectOraclePrices()",
  "function startDispute()",
  "function startSettling()",
  "function executeSettlement()",
  "function getUncrossedRemainder(uint256) view returns (bool,uint256)",
  "function routeUncrossedToAqua(uint256,uint256,bytes)",
];

// Optional post-settlement hook: route the just-settled batch's uncrossed remainder to 1inch Aqua.
type AfterSettle = (settledBatchId: string) => Promise<string | null>;

// Build the Aqua routing config from env; returns undefined unless the router + key + assets are set.
function buildAquaConfig(): AquaConfig | undefined {
  const aquaRouter = process.env.AQUA_ROUTER_ADDRESS;
  const apiKey = process.env.ONEINCH_API_KEY;
  const baseAsset = process.env.BASE_ASSET;
  const quoteAsset = process.env.QUOTE_ASSET;
  if (!aquaRouter || !apiKey || !baseAsset || !quoteAsset) return undefined;
  return {
    aquaRouter,
    apiKey,
    baseAsset,
    quoteAsset,
    chainId: Number(process.env.AQUA_CHAIN_ID ?? 1),
    slippageBps: Number(process.env.AQUA_SLIPPAGE_BPS ?? 100),
  };
}

const TICK_MS = Number(process.env.TICK_MS ?? 12_000); // ~1 block

// A crank executor: maps a decided action to an onchain call, returning a tx
// hash / Circle tx id (or null for `wait`).
type Executor = (a: CrankAction) => Promise<string | null>;

async function tick(
  provider: ethers.Provider,
  readContract: ethers.Contract,
  execute: Executor,
  subgraphUrl: string | undefined,
  afterSettle?: AfterSettle,
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

  // After a batch settles, route its uncrossed remainder to 1inch Aqua (when configured).
  if (action.kind === "executeSettlement" && ref && afterSettle) {
    const routed = await afterSettle(state.batchId);
    if (routed) console.log(new Date().toISOString(), `aqua-routed batch=${state.batchId}`, routed);
  }
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
  // A raw-key write contract is used for the Aqua routing tx (which carries calldata args). It is
  // created whenever a PRIVATE_KEY is available, independently of whether cranks go through Circle.
  let writeContract: ethers.Contract | undefined;
  if (process.env.PRIVATE_KEY) {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    writeContract = readContract.connect(wallet) as ethers.Contract;
  }
  if (useCircle) {
    const sdk = makeCircleClient();
    const walletId = process.env.CIRCLE_WALLET_ID!;
    execute = (a) => executeCrankViaCircle(sdk, walletId, aegisAddress, a);
    signer = `circle:${process.env.CIRCLE_WALLET_ADDRESS ?? walletId}`;
  } else {
    if (!writeContract) throw new Error("PRIVATE_KEY or CIRCLE_* required");
    execute = (a) => executeCrank(writeContract!, a);
    signer = (writeContract.runner as ethers.Wallet).address;
  }

  // Wire the post-settlement 1inch Aqua routing hook when AQUA_ROUTER_ADDRESS + ONEINCH_API_KEY are
  // configured and a raw signer is available (routeUncrossedToAqua carries calldata args).
  const aquaCfg = buildAquaConfig();
  const afterSettle: AfterSettle | undefined =
    aquaCfg && writeContract
      ? (batchId) => routeUncrossedIfConfigured(writeContract!, Number(batchId), aquaCfg)
      : undefined;

  console.log(
    `Aegis Solver Agent — aegis=${aegisAddress} signer=${signer} ` +
      `subgraph=${subgraphUrl ?? "(contract fallback)"} aqua=${aquaCfg ? aquaCfg.aquaRouter : "(off)"}`,
  );

  for (;;) {
    try {
      await tick(provider, readContract, execute, subgraphUrl, afterSettle);
    } catch (e) {
      // Reverts (e.g. cranking too early against a lagged subgraph) are
      // expected and non-fatal — log and keep ticking.
      console.error("tick error", (e as Error).message ?? e);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
