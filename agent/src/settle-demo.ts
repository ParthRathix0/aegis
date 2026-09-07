import "dotenv/config";
import { ethers } from "ethers";
import { decideAction } from "./decide";
import { phaseFromState } from "./subgraph";
import { crankSignature, depositCallsForIntent, makeCircleClient, CircleClient } from "./circle";

// One-shot live demo: drive a real Aegis batch to settlement with the Circle
// Agent Stack as the settlement engine. The Circle wallet deposits USDC (a BUY
// payment intent) and signs every crank; a raw-key seller deposits WETH so the
// batch actually crosses and USDC settles. Captures all tx hashes to
// settlement-evidence.json as the Arc/Circle submission artifact.

const RPC = process.env.RPC_URL!;
const AEGIS = process.env.AEGIS_ADDRESS!;
const USDC = process.env.QUOTE_ASSET!;
const WETH = process.env.BASE_ASSET!;
const WALLET_ID = process.env.CIRCLE_WALLET_ID!;
const BUY_USDC = BigInt(process.env.DEMO_BUY_USDC ?? "5000000"); // 5 USDC (6 dec)
const SELL_WETH = BigInt(process.env.DEMO_SELL_WETH ?? "10000000000000000"); // 0.01 WETH (18 dec)

const ABI = [
  "function getCurrentBatchInfo() view returns (uint256,uint8,uint256,uint256,uint256,uint256)",
  "function lastCollectionBlock() view returns (uint256)",
  "function startAccumulation()",
  "function deposit(uint256,uint8)",
  "function claim(uint256)",
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
];

const evidence: Record<string, string> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll a Circle transaction id until it lands on-chain; returns the tx hash.
async function waitCircle(sdk: CircleClient, id: string, label: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res: any = await sdk.getTransaction({ id });
    const tx = res?.data?.transaction ?? {};
    if (tx.txHash && (tx.state === "CONFIRMED" || tx.state === "COMPLETE")) {
      console.log(`  ✓ ${label}: ${tx.txHash} (${tx.state})`);
      evidence[label] = tx.txHash;
      return tx.txHash;
    }
    if (tx.state === "FAILED" || tx.state === "CANCELLED") throw new Error(`${label} ${tx.state}`);
    await sleep(5000);
  }
  throw new Error(`${label} not confirmed in time`);
}

async function circleExec(
  sdk: CircleClient,
  contractAddress: string,
  sig: string,
  params: string[],
  label: string,
): Promise<string> {
  const res: any = await sdk.createContractExecutionTransaction({
    walletId: WALLET_ID,
    contractAddress,
    abiFunctionSignature: sig,
    abiParameters: params,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  return waitCircle(sdk, res.data?.id, label);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const seller = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const read = new ethers.Contract(AEGIS, ABI, provider);
  const sdk = makeCircleClient();
  console.log(`settle-demo — aegis=${AEGIS} seller=${seller.address} circleWallet=${WALLET_ID}`);

  // 1) Reopen the deposit window: if OPEN, crank startAccumulation via Circle.
  let [batchId, state] = await read.getCurrentBatchInfo();
  console.log(`batch ${batchId} state=${state}`);
  if (Number(state) === 0) {
    console.log("startAccumulation (Circle) — reopens deposit window...");
    await circleExec(sdk, AEGIS, "startAccumulation()", [], "startAccumulation");
    await sleep(4000);
  }
  [batchId, state] = await read.getCurrentBatchInfo();
  const bid = batchId.toString();
  console.log(`batch ${bid} state=${state} (accepting deposits)`);

  // 2) SELL side (raw key): mint WETH, approve, deposit.
  const weth = new ethers.Contract(WETH, ABI, seller);
  console.log(`seller: mint+approve+deposit ${SELL_WETH} WETH (SELL)...`);
  evidence["seller.mint"] = (await (await weth.mint(seller.address, SELL_WETH)).wait())!.hash;
  evidence["seller.approve"] = (await (await weth.approve(AEGIS, SELL_WETH)).wait())!.hash;
  const aegisSeller = new ethers.Contract(AEGIS, ABI, seller);
  evidence["seller.deposit"] = (await (await aegisSeller.deposit(SELL_WETH, 1)).wait())!.hash;
  console.log(`  ✓ seller SELL deposit: ${evidence["seller.deposit"]}`);

  // 3) BUY side (Circle): approve USDC + deposit as a payment intent.
  const [approveCall, depositCall] = depositCallsForIntent(
    { payWith: "QUOTE", amount: BUY_USDC },
    { aegis: AEGIS, usdc: USDC, weth: WETH },
  );
  console.log(`Circle: approve ${BUY_USDC} USDC → Aegis...`);
  await circleExec(sdk, approveCall.contractAddress, approveCall.abiFunctionSignature, approveCall.abiParameters, "circle.approveUSDC");
  console.log(`Circle: deposit ${BUY_USDC} USDC (BUY payment intent)...`);
  await circleExec(sdk, depositCall.contractAddress, depositCall.abiFunctionSignature, depositCall.abiParameters, "circle.depositUSDC");

  // 4) Crank to settlement via Circle, reusing the tested decision core.
  console.log("cranking to settlement (Circle-signed)...");
  for (let i = 0; i < 400; i++) {
    const [, st, endBlock] = await read.getCurrentBatchInfo();
    const lastCollect = await read.lastCollectionBlock();
    const block = await provider.getBlockNumber();
    const action = decideAction(
      { batchId: bid, phase: phaseFromState(Number(st)), endBlock: Number(endBlock), lastCollectBlock: Number(lastCollect) },
      block,
    );
    if (action.kind === "wait") { await sleep(12000); continue; }
    const sig = crankSignature(action)!;
    try {
      const h = await circleExec(sdk, AEGIS, sig, [], `crank.${action.kind}`);
      console.log(`  ${action.kind} @${block} → ${h}`);
    } catch (e) {
      console.error(`  ${action.kind} reverted/failed: ${(e as Error).message}`); await sleep(12000);
    }
    if (action.kind === "executeSettlement") break;
    await sleep(6000);
  }

  // 5) Claims — seller receives USDC (native-USDC settlement), buyer receives WETH.
  console.log("claiming...");
  evidence["seller.claim"] = (await (await aegisSeller.claim(bid)).wait())!.hash;
  console.log(`  ✓ seller claim (receives USDC): ${evidence["seller.claim"]}`);
  await circleExec(sdk, AEGIS, "claim(uint256)", [bid], "circle.claim");

  const fs = await import("fs");
  fs.writeFileSync("settlement-evidence.json", JSON.stringify(evidence, null, 2));
  console.log("\n=== SETTLEMENT EVIDENCE (settlement-evidence.json) ===");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((e) => { console.error("settle-demo failed:", e); process.exit(1); });
