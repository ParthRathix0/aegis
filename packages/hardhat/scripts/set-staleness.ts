import { ethers } from "hardhat";

// Widen staleness tolerance so Sepolia's slow-cadence API3 dAPI counts alongside
// Chainlink (>= 2 valid oracles required to settle). Testnet feeds update slowly.
async function main() {
  const aegis = await ethers.getContractAt("AegisV4", "0x0a16364229EeFDA44332cB6D194E20937C51CE5b");
  const target = 86400; // 24h
  const before = await aegis.maxStaleness();
  console.log(`maxStaleness before: ${before}`);
  const tx = await aegis.setMaxStaleness(target);
  await tx.wait();
  console.log(`setMaxStaleness(${target}) tx: ${tx.hash}`);
  console.log(`maxStaleness after: ${await aegis.maxStaleness()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
