import { ethers } from "hardhat";

async function main() {
  const aegis = await ethers.getContractAt("AegisV4", "0x0a16364229EeFDA44332cB6D194E20937C51CE5b");
  const txs = [
    "0x1a2590c67be8d7a1eecf03abc8ada89d8e72f0d0a45487a84fee4068b5c8a08e", // batch0 startDispute
    "0xd148d94d207e570c7508d477eeb98f9c07bb0926be4cfd297399c5f998336e49", // batch1 startDispute
  ];
  for (const h of txs) {
    const r = await ethers.provider.getTransactionReceipt(h);
    console.log(`\ntx ${h.slice(0, 12)} status=${r?.status} logs=${r?.logs.length}`);
    for (const log of r!.logs) {
      try {
        const p = aegis.interface.parseLog(log);
        if (p) console.log(`  ${p.name}(${p.args.map((a: any) => a.toString()).join(", ")})`);
      } catch {
        /* not an AegisV4 event */
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
