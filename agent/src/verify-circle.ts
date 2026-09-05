import "dotenv/config";
import { makeCircleClient } from "./circle";

// Read-only check that the wired Circle Agent Stack credentials work: fetches
// the agent wallet and its token balances. Run with `yarn circle:verify`.
// (The live crank/settlement writes happen once AegisV4 is deployed to the
// target network — this just proves the wallet + SDK are correctly wired.)
async function main() {
  const sdk = makeCircleClient();
  const id = process.env.CIRCLE_WALLET_ID!;

  const wallet = await sdk.getWallet({ id });
  const w = wallet.data?.wallet;
  console.log("wallet:", {
    id: w?.id,
    address: w?.address,
    blockchain: w?.blockchain,
    state: w?.state,
  });

  const balances = await sdk.getWalletTokenBalance({ id });
  const tokens = balances.data?.tokenBalances ?? [];
  if (tokens.length === 0) {
    console.log("balances: (none — fund with testnet USDC)");
  } else {
    for (const t of tokens) {
      console.log(`balance: ${t.amount} ${t.token?.symbol ?? t.token?.name ?? "?"}`);
    }
  }
}

main().catch((e) => {
  console.error("circle verify failed:", e?.message ?? e);
  process.exit(1);
});
