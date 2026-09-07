import "dotenv/config";
import { makeCircleClient } from "./circle";

// Create a developer-controlled wallet on ARC-TESTNET (same wallet set as the
// Sepolia agent wallet) so the Circle Agent Stack can settle USDC natively on Arc.
async function main() {
  const sdk = makeCircleClient();
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID!;
  const res: any = await sdk.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"] as any,
    count: 1,
    accountType: "EOA",
  });
  const w = res?.data?.wallets?.[0];
  console.log("ARC wallet created:");
  console.log(JSON.stringify({ id: w?.id, address: w?.address, blockchain: w?.blockchain }, null, 2));
}
main().catch((e) => { console.error("create failed:", e?.response?.data ?? e?.message ?? e); process.exit(1); });
