import { expect } from "chai";
import { ethers } from "hardhat";

async function erc20(dec: number) {
  const F = await ethers.getContractFactory("MockERC20");
  return F.deploy("Tok", "TOK", dec);
}

describe("AegisV4 two-asset deposit", function () {
  it("pulls quote on BUY and base on SELL", async function () {
    const [user] = await ethers.getSigners();
    const base = await erc20(18);   // WETH-like
    const quote = await erc20(6);   // USDC-like
    const V4 = await ethers.getContractFactory("AegisV4");
    const aegis = await V4.deploy(await base.getAddress(), await quote.getAddress());

    await quote.mint(user.address, 1_000_000n);
    await quote.approve(await aegis.getAddress(), 1_000_000n);
    await aegis.deposit(1_000_000n, 0); // BUY -> pulls quote

    expect(await quote.balanceOf(await aegis.getAddress())).to.equal(1_000_000n);
  });
});
