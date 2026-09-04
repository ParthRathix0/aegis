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

  it("scales a less-negative expo up (multiply branch, expo -5)", async function () {
    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pyth = await MockPyth.deploy();
    // $2000 with expo -5 => price 200000000 (200000000 * 10^-5 = 2000)
    await pyth.setPrice(ETH_USD_ID, 200000000n, -5, Math.floor(Date.now() / 1000));

    const Adapter = await ethers.getContractFactory("PythOracleAdapter");
    const adapter = await Adapter.deploy(await pyth.getAddress(), ETH_USD_ID);

    const [, answer] = await adapter.latestRoundData();
    expect(answer).to.equal(200000000000n); // scaled up to 8 decimals
  });

  it("scales a more-negative expo down (divide branch, expo -10)", async function () {
    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pyth = await MockPyth.deploy();
    // $2000 with expo -10 => price 20000000000000 (20000000000000 * 10^-10 = 2000)
    await pyth.setPrice(ETH_USD_ID, 20000000000000n, -10, Math.floor(Date.now() / 1000));

    const Adapter = await ethers.getContractFactory("PythOracleAdapter");
    const adapter = await Adapter.deploy(await pyth.getAddress(), ETH_USD_ID);

    const [, answer] = await adapter.latestRoundData();
    expect(answer).to.equal(200000000000n); // scaled down to 8 decimals
  });
});

describe("API3OracleAdapter", function () {
  it("scales API3 18-decimal value to 8 decimals", async function () {
    const MockProxy = await ethers.getContractFactory("MockApi3Proxy");
    const proxy = await MockProxy.deploy();
    // $2000 with 18 decimals
    await proxy.set(2000n * 10n ** 18n, Math.floor(Date.now() / 1000));

    const Adapter = await ethers.getContractFactory("API3OracleAdapter");
    const adapter = await Adapter.deploy(await proxy.getAddress());

    const [, answer] = await adapter.latestRoundData();
    expect(answer).to.equal(200000000000n); // 8 decimals
  });

  it("scales a different 18-decimal value proportionally (e.g. $3500)", async function () {
    const MockProxy = await ethers.getContractFactory("MockApi3Proxy");
    const proxy = await MockProxy.deploy();
    await proxy.set(3500n * 10n ** 18n, Math.floor(Date.now() / 1000));

    const Adapter = await ethers.getContractFactory("API3OracleAdapter");
    const adapter = await Adapter.deploy(await proxy.getAddress());

    const [, answer] = await adapter.latestRoundData();
    expect(answer).to.equal(350000000000n); // $3500 at 8 decimals
  });
});
