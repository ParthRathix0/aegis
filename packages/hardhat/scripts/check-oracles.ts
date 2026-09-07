import { ethers } from "hardhat";

const FEEDS: [string, string][] = [
  ["Chainlink (1)", "0x694AA1769357215DE4FAC081bf1f309aDC325306"],
  ["PythAdapter (2)", "0x6D6a3A5259337139149e1f368811B715f97C7F87"],
  ["API3Adapter (3)", "0x3FabF9780667833f5A5B3FEF433649E24949D894"],
];
const IFACE = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const maxStaleness = 7200;
  for (const [name, addr] of FEEDS) {
    const c = new ethers.Contract(addr, IFACE, ethers.provider);
    try {
      const [, answer, , updatedAt] = await c.latestRoundData();
      const age = now - Number(updatedAt);
      const price = Number(answer) / 1e8;
      console.log(`${name}: price=$${price.toFixed(2)} updatedAt=${updatedAt} age=${age}s stale?=${age > maxStaleness ? "YES (skipped)" : "no"}`);
    } catch (e) {
      console.log(`${name}: REVERTED — ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
