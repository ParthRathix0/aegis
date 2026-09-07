import { ethers } from "hardhat";

// Decode the Arc settlement + claim events to show the exact USDC/WETH that moved.
async function main() {
  const aegis = await ethers.getContractAt("AegisV4", "0xf520B2eE9AD41BA0AD1Ba313ce25dfa0f1361fB8");
  const txs: [string, string][] = [
    ["executeSettlement", "0x614475f587a64653c209660a25ee7bc875a5fd11280e66253ad2236f282d49c9"],
    ["seller.claim", "0xd83380f55f3c74766d637299f98cadd435844403a079eb223d0044dd4fd2dee1"],
    ["circle.claim", "0xe4f2ec05359ad0e65ba00f2ee3911820b52fa996a6feaa0fcc6d3674eb1325f5"],
  ];
  for (const [label, h] of txs) {
    const r = await ethers.provider.getTransactionReceipt(h);
    console.log(`\n${label} (status=${r?.status}):`);
    for (const log of r!.logs) {
      try {
        const p = aegis.interface.parseLog(log);
        if (p) console.log(`  ${p.name}(${p.args.map((a: any) => a.toString()).join(", ")})`);
      } catch {
        /* ignore non-AegisV4 logs (e.g. raw ERC-20 transfers) */
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
