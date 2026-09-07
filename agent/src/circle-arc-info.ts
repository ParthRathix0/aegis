import "dotenv/config";
import { makeCircleClient } from "./circle";

// Read-only: inspect the current Circle wallet + wallet set so we know whether
// the existing wallet can sign on Arc, or whether we need an Arc-TESTNET wallet.
async function main() {
  const sdk = makeCircleClient();
  const walletId = process.env.CIRCLE_WALLET_ID!;
  const w: any = await sdk.getWallet({ id: walletId });
  const t = w?.data?.wallet ?? {};
  console.log("current wallet:", JSON.stringify({ id: t.id, address: t.address, blockchain: t.blockchain, accountType: t.accountType, walletSetId: t.walletSetId }, null, 2));

  const setId = process.env.CIRCLE_WALLET_SET_ID || t.walletSetId;
  if (setId) {
    const list: any = await sdk.listWallets({ walletSetId: setId } as any);
    const ws = (list?.data?.wallets ?? []).map((x: any) => ({ id: x.id, address: x.address, blockchain: x.blockchain }));
    console.log(`wallets in set ${setId}:`, JSON.stringify(ws, null, 2));
  }
}
main().catch((e) => { console.error("info failed:", e?.response?.data ?? e?.message ?? e); process.exit(1); });
