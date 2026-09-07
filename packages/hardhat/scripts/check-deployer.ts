import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  const net = await ethers.provider.getNetwork();
  console.log("network chainId:", net.chainId.toString());
  console.log("deployer:", signer.address);
  console.log("balance:", ethers.formatEther(bal), "ETH");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
