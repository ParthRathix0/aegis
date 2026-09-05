import { expect } from "chai";
import { ethers } from "hardhat";

describe("BatchAuction library", function () {
  it("fully fills the smaller side, partially the larger", async function () {
    const H = await ethers.getContractFactory("BatchAuctionHarness");
    const h = await H.deploy();
    // buy 3, sell 1 -> sell fully filled (1e18), buy filled 1/3
    const [buyRatio, sellRatio] = await h.fillRatios(3, 1);
    expect(sellRatio).to.equal(10n ** 18n);
    expect(buyRatio).to.equal(10n ** 18n / 3n);
  });

  it("fully fills both sides when volumes are equal", async function () {
    const H = await ethers.getContractFactory("BatchAuctionHarness");
    const h = await H.deploy();
    const [buyRatio, sellRatio] = await h.fillRatios(5, 5);
    expect(buyRatio).to.equal(10n ** 18n);
    expect(sellRatio).to.equal(10n ** 18n);
  });

  it("returns zeros when either side is empty", async function () {
    const H = await ethers.getContractFactory("BatchAuctionHarness");
    const h = await H.deploy();
    const [b1, s1] = await h.fillRatios(0, 7);
    expect(b1).to.equal(0n);
    expect(s1).to.equal(0n);
    const [b2, s2] = await h.fillRatios(7, 0);
    expect(b2).to.equal(0n);
    expect(s2).to.equal(0n);
  });

  it("partially fills buy when sell is the larger side", async function () {
    const H = await ethers.getContractFactory("BatchAuctionHarness");
    const h = await H.deploy();
    // buy 1, sell 4 -> buy fully filled, sell filled 1/4
    const [buyRatio, sellRatio] = await h.fillRatios(1, 4);
    expect(buyRatio).to.equal(10n ** 18n);
    expect(sellRatio).to.equal(10n ** 18n / 4n);
  });
});
