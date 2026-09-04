import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys Aegis V3.0. On Sepolia: registers the real Chainlink ETH/USD Data Feed
 * (techStackId 1) plus real Pyth (stack 2) + API3 (stack 3) adapters for genuine
 * 3-tech-stack oracle diversity. On other networks: deploys 5 mock oracles for local testing.
 */
const deployAegisV3: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  console.log("\n🚀 Deploying Aegis V3.0 Multi-Oracle System...\n");

  let mockWETHAddress;
  let deployedOracles: string[] = [];
  let techStackIds: number[] = [];

  const CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // real Chainlink ETH/USD, 8 decimals
  const SEPOLIA_WETH = "0x46059af680A19f3D149B3B8049D3aecA9050914C";
  // Plan 2: real independent same-asset feeds via Chainlink-interface adapters
  const PYTH_SEPOLIA = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21";
  const PYTH_ETH_USD_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const API3_ETH_USD_PROXY = "0x5b0cf2b36a65a6BB085D501B971e4c102B9Cd473";

  if (network === "sepolia") {
    console.log("🌍 Using real Chainlink ETH/USD + Pyth + API3 adapters on Sepolia...");
    mockWETHAddress = SEPOLIA_WETH;
    deployedOracles = [CHAINLINK_ETH_USD];
    techStackIds = [1];

    console.log("📡 Deploying Pyth + API3 oracle adapters (real same-asset feeds)...");
    const pythAdapter = await deploy("PythOracleAdapter", {
      from: deployer,
      args: [PYTH_SEPOLIA, PYTH_ETH_USD_ID],
      log: true,
      autoMine: true,
    });
    deployedOracles.push(pythAdapter.address);
    techStackIds.push(2);

    const api3Adapter = await deploy("API3OracleAdapter", {
      from: deployer,
      args: [API3_ETH_USD_PROXY],
      log: true,
      autoMine: true,
    });
    deployedOracles.push(api3Adapter.address);
    techStackIds.push(3);
  } else {
    // Deploy mock token for trading
    console.log("📦 Deploying Mock WETH token...");
    const mockWETH = await deploy("MockWETH", {
      contract: "contracts/mocks/MockWETH.sol:MockWETH",
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    mockWETHAddress = mockWETH.address;
    console.log(`✅ MockWETH deployed at: ${mockWETH.address}\n`);

    // Deploy 5 mock oracles with different characteristics
    const oracleConfigs = [
      { name: "GoodOracle1", price: 200000000000, deviation: 0, volatile: false }, // $2000
      { name: "GoodOracle2", price: 200000000000, deviation: 0, volatile: false },
      { name: "GoodOracle3", price: 200000000000, deviation: 0, volatile: false },
      { name: "SlightlyOffOracle", price: 200000000000, deviation: 200, volatile: false }, // +2%
      { name: "VolatileOracle", price: 200000000000, deviation: 0, volatile: true },
    ];

    for (const config of oracleConfigs) {
      console.log(`📡 Deploying ${config.name}...`);
      const oracle = await deploy(config.name, {
        contract: "contracts/mocks/MockOracle.sol:MockOracle",
        from: deployer,
        args: [config.price],
        log: true,
        autoMine: true,
      });

      // Configure oracle
      if (oracle.newlyDeployed) {
        const oracleContract = await hre.ethers.getContractAt("MockOracle", oracle.address);
        if (config.deviation !== 0) {
          await oracleContract.setDeviation(config.deviation);
          console.log(`   ⚙️  Set deviation: ${config.deviation / 100}%`);
        }
        if (config.volatile) {
          await oracleContract.setVolatile(true);
          console.log(`   ⚙️  Enabled volatility`);
        }
      }

      deployedOracles.push(oracle.address);
      techStackIds.push(1);
      console.log(`✅ ${config.name} deployed at: ${oracle.address}\n`);
      
      // Wait 5 seconds between deployments to avoid nonce issues
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Extra delay before deploying main contract
  console.log("⏳ Waiting before main contract deployment...");
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Deploy main Aegis V3 contract
  console.log("🛡️  Deploying AegisV3 main contract...");
  const aegisV3 = await deploy("AegisV3", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
  console.log(`✅ AegisV3 deployed at: ${aegisV3.address}\n`);

  // Setup: Register oracles and set asset
  console.log("⚙️  Setting up Aegis V3...\n");
  const aegisContract = await hre.ethers.getContractAt("AegisV3", aegisV3.address);

  if (network === "sepolia") {
    console.log("⏱️  Raising maxStaleness to 7200s for real Chainlink heartbeats...");
    await (await aegisContract.setMaxStaleness(7200)).wait();
  }

  console.log("📝 Registering oracles...");
  for (let i = 0; i < deployedOracles.length; i++) {
    try {
      // Check if already registered to save gas
      const oracleInfo = await aegisContract.getOracleInfo(i + 1).catch(() => null);
      if (!oracleInfo || oracleInfo.oracleAddress !== deployedOracles[i]) {
        const techStackId = techStackIds[i] ?? 1;
        const tx = await aegisContract.registerOracle(deployedOracles[i], techStackId);
        await tx.wait();
        console.log(`   ✓ Oracle ${i + 1} registered: ${deployedOracles[i]}`);
      } else {
        console.log(`   ✓ Oracle ${i + 1} already registered: ${deployedOracles[i]}`);
      }
    } catch (e: any) {
      console.log(`   ⚠️ Error registering oracle ${i + 1}: ${e.message}`);
    }
  }

  console.log("\n💰 Setting batch asset to MockWETH...");
  try {
    const currentBatchId = await aegisContract.currentBatchId();
    const batchInfo = await aegisContract.batches(currentBatchId);
    // batchInfo is an array/object where the second element (index 1) is the asset address
    // Struct: state, asset, openEnd, ...
    const currentAsset = batchInfo[1]; // or batchInfo.asset if using typechain/ethers object

    if (currentAsset !== mockWETHAddress) {
      const setAssetTx = await aegisContract.setBatchAsset(mockWETHAddress);
      await setAssetTx.wait();
      console.log(`   ✓ Asset set to: ${mockWETHAddress}`);
    } else {
      console.log(`   ✓ Asset already set to: ${mockWETHAddress}`);
    }
  } catch (e: any) {
    console.log(`   ⚠️ Error setting asset: ${e.message}`);
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(80));
  console.log("\n📊 Deployment Summary:");
  console.log(`   • AegisV3 Contract: ${aegisV3.address}`);
  console.log(`   • Trading Asset (WETH): ${mockWETHAddress}`);
  console.log(`   • Oracles Registered: ${deployedOracles.length}`);
  console.log("\n🔍 Oracle Details:");
  deployedOracles.forEach((addr, i) => {
    console.log(`   ${i + 1}. Oracle ${i + 1}: ${addr}`);
  });

  console.log("\n📝 Next Steps:");
  console.log("   1. Run keeper bot: yarn hardhat run scripts/keeper-bot.ts --network localhost");
  console.log("   2. Simulate users: yarn hardhat run scripts/simulate-users.ts --network localhost");
  console.log("   3. Monitor dashboard: yarn start\n");

  console.log("💡 Quick Test Commands:");
  console.log(`   const aegis = await ethers.getContractAt("AegisV3", "${aegisV3.address}");`);
  console.log(`   await aegis.getCurrentBatchInfo();`);
  console.log(`   await aegis.getOracleInfo(1);`);
  console.log("\n");
};

export default deployAegisV3;
deployAegisV3.tags = ["AegisV3", "MockOracles"];
