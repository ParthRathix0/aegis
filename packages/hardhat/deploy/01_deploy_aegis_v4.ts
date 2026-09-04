import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys Aegis V4.0 (two-asset base/quote swap).
 *
 * Network branches:
 *   sepolia  — base=SEPOLIA_WETH (existing MockWETH or WETH), quote=SEPOLIA_USDC (Circle test USDC);
 *              registers real Chainlink (stack 1), PythOracleAdapter (stack 2), API3OracleAdapter (stack 3).
 *   hardhat/localhost — deploys MockWETH + MockERC20(USDC) locally;
 *              deploys 2 MockOracles and registers them (stacks 1, 2) so validCount>=2 works locally.
 *
 * setMaxStaleness(7200) applied on all networks to accommodate real feed heartbeats.
 */
const deployAegisV4: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  // ── Sepolia constants ───────────────────────────────────────────────────────
  const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Circle test USDC (6 dec)
  const CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // 8 dec
  const PYTH_ORACLE_ADAPTER = "0xDFdd46c593586028739E063204b8741bc3EF730D"; // deployed Plan 2
  const API3_ORACLE_ADAPTER = "0x111ef8C8d0d9875194B3D630319327620C5c9996"; // deployed Plan 2

  console.log("\nDeploying Aegis V4.0 (two-asset swap)...\n");
  console.log(`Network: ${network}`);

  // ── Base asset (WETH) ───────────────────────────────────────────────────────
  let baseAddr: string;
  const existingMockWETH = await hre.deployments.getOrNull("MockWETH");
  if (existingMockWETH) {
    baseAddr = existingMockWETH.address;
    console.log(`Reusing existing MockWETH at: ${baseAddr}`);
  } else {
    const mockWETH = await deploy("MockWETH", {
      contract: "contracts/mocks/MockWETH.sol:MockWETH",
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    baseAddr = mockWETH.address;
    console.log(`MockWETH deployed at: ${baseAddr}`);
  }

  // ── Quote asset (USDC) ──────────────────────────────────────────────────────
  let quoteAddr: string;
  if (network === "sepolia") {
    quoteAddr = SEPOLIA_USDC;
    console.log(`Using Circle test USDC (Sepolia): ${quoteAddr}`);
  } else {
    const mockUSDC = await deploy("MockUSDC", {
      contract: "contracts/mocks/MockERC20.sol:MockERC20",
      from: deployer,
      args: ["USD Coin", "USDC", 6],
      log: true,
      autoMine: true,
    });
    quoteAddr = mockUSDC.address;
    console.log(`MockUSDC (MockERC20) deployed at: ${quoteAddr}`);
  }

  // ── Deploy AegisV4 ──────────────────────────────────────────────────────────
  const aegisV4Deploy = await deploy("AegisV4", {
    from: deployer,
    args: [baseAddr, quoteAddr],
    log: true,
    autoMine: true,
  });
  console.log(`AegisV4 deployed at: ${aegisV4Deploy.address}`);

  // ── Post-deploy configuration ───────────────────────────────────────────────
  const aegis = await hre.ethers.getContractAt("AegisV4", aegisV4Deploy.address);

  console.log("Setting maxStaleness = 7200s...");
  await (await aegis.setMaxStaleness(7200)).wait();

  // ── Oracle registration ─────────────────────────────────────────────────────
  if (network === "sepolia") {
    console.log("Registering real oracles on Sepolia...");

    console.log(`  Registering Chainlink ETH/USD (stack 1): ${CHAINLINK_ETH_USD}`);
    await (await aegis.registerOracle(CHAINLINK_ETH_USD, 1)).wait();

    console.log(`  Registering PythOracleAdapter (stack 2): ${PYTH_ORACLE_ADAPTER}`);
    await (await aegis.registerOracle(PYTH_ORACLE_ADAPTER, 2)).wait();

    console.log(`  Registering API3OracleAdapter (stack 3): ${API3_ORACLE_ADAPTER}`);
    await (await aegis.registerOracle(API3_ORACLE_ADAPTER, 3)).wait();

    console.log("All 3 real oracles registered.");
  } else {
    // Local: deploy 2 MockOracles so validCount >= 2 threshold is met
    console.log("Deploying and registering 2 MockOracles for local testing...");

    const oracle1 = await deploy("MockOracleV4_1", {
      contract: "contracts/mocks/MockOracle.sol:MockOracle",
      from: deployer,
      args: [200000000000], // $2000 * 1e8 (8 dec, Chainlink-style)
      log: true,
      autoMine: true,
    });
    console.log(`  MockOracleV4_1 at: ${oracle1.address}`);
    await (await aegis.registerOracle(oracle1.address, 1)).wait();
    console.log("  Registered MockOracleV4_1 as techStackId 1");

    const oracle2 = await deploy("MockOracleV4_2", {
      contract: "contracts/mocks/MockOracle.sol:MockOracle",
      from: deployer,
      args: [200000000000],
      log: true,
      autoMine: true,
    });
    console.log(`  MockOracleV4_2 at: ${oracle2.address}`);
    await (await aegis.registerOracle(oracle2.address, 2)).wait();
    console.log("  Registered MockOracleV4_2 as techStackId 2");
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("AEGIS V4 DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));
  console.log(`  AegisV4:    ${aegisV4Deploy.address}`);
  console.log(`  baseAsset:  ${baseAddr}  (WETH)`);
  console.log(`  quoteAsset: ${quoteAddr}  (USDC)`);
  if (network === "sepolia") {
    console.log(`  Oracles:    Chainlink(1) + Pyth(2) + API3(3)`);
  } else {
    console.log(`  Oracles:    MockOracleV4_1(1) + MockOracleV4_2(2)`);
  }
  console.log("=".repeat(70) + "\n");
};

export default deployAegisV4;
deployAegisV4.tags = ["AegisV4"];
