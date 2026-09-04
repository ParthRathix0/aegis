import { expect } from "chai";
import { ethers } from "hardhat";

describe("AegisV3 Protocol", function () {
  it("Should deploy AegisV3 successfully", async function () {
    const [owner] = await ethers.getSigners();
    
    // Deploy AegisV3 contract
    const AegisV3 = await ethers.getContractFactory("AegisV3");
    const aegis = await AegisV3.deploy();
    
    // Verify deployment
    expect(await aegis.getAddress()).to.be.properAddress;
    console.log("    ✓ AegisV3 deployed at:", await aegis.getAddress());
  });

  it("Should register and verify oracle", async function () {
    const [owner] = await ethers.getSigners();

    // Deploy Mock Oracle with initial price of $2000
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy(200000000000); // 8 decimals
    const oracleAddress = await oracle.getAddress();

    // Deploy AegisV3
    const AegisV3 = await ethers.getContractFactory("AegisV3");
    const aegis = await AegisV3.deploy();

    // Register oracle as a Chainlink-stack oracle (techStackId = 1)
    await aegis.registerOracle(oracleAddress, 1);

    // Verify oracle registration
    const oracleInfo = await aegis.getOracleInfo(1);
    expect(oracleInfo.oracleAddress).to.equal(oracleAddress);
    expect(oracleInfo.isActive).to.be.true;
    expect(oracleInfo.weight).to.equal(1); // new oracles start on probation (WEIGHT_MIN)

    console.log("    ✓ Oracle registered with weight:", oracleInfo.weight.toString());
  });

  it("Should register multiple oracles", async function () {
    const [owner] = await ethers.getSigners();

    // Deploy AegisV3
    const AegisV3 = await ethers.getContractFactory("AegisV3");
    const aegis = await AegisV3.deploy();

    // Deploy and register 3 oracles
    const MockOracle = await ethers.getContractFactory("MockOracle");

    for (let i = 1; i <= 3; i++) {
      const oracle = await MockOracle.deploy(200000000000);
      await aegis.registerOracle(await oracle.getAddress(), 1);

      const oracleInfo = await aegis.getOracleInfo(i);
      expect(oracleInfo.isActive).to.be.true;
    }

    console.log("    ✓ Successfully registered 3 oracles");
  });
});
