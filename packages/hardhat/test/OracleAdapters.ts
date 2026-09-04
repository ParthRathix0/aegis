import { expect } from "chai";
import { ethers } from "hardhat";

describe("PythOracleAdapter", function () {
  const ETH_USD_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

  it("returns Pyth price scaled to 8 decimals via latestRoundData", async function () {
    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pyth = await MockPyth.deploy();
    // $2000 with expo -8 => price 200000000000
    await pyth.setPrice(ETH_USD_ID, 200000000000n, -8, Math.floor(Date.now() / 1000));

    const Adapter = await ethers.getContractFactory("PythOracleAdapter");
    const adapter = await Adapter.deploy(await pyth.getAddress(), ETH_USD_ID);

    const [, answer] = await adapter.latestRoundData();
    expect(answer).to.equal(200000000000n); // 8 decimals
  });
});
