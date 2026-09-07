import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys Aegis V4.0 (two-asset base/quote swap).
 *
 * Network branches:
 *   sepolia  — base=SEPOLIA_WETH (existing MockWETH or WETH), quote=SEPOLIA_USDC (Circle test USDC);
 *              deploys FRESH Pyth + API3 adapters and registers real Chainlink (stack 1),
 *              PythOracleAdapter (stack 2), API3OracleAdapter (stack 3).
 *   hardhat/localhost — deploys MockWETH + MockERC20(USDC) locally;
 *              deploys 2 MockOracles and registers them (stacks 1, 2) so validCount>=2 works locally.
 *
 * All networks: sets maxStaleness(7200) for real feed heartbeats, and deploys + wires an
 * AquaRouter (1inch Aqua/SwapVM) via setAquaRouter for uncrossed-remainder routing.
 */
const deployAegisV4: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  // ── Sepolia constants ───────────────────────────────────────────────────────
  const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Circle test USDC (6 dec)
  const CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // stack 1, 8 dec
  // Fresh oracle adapters are deployed below (superseded Plan-2 throwaway addresses removed).
  const PYTH_SEPOLIA = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Pyth contract (Sepolia)
  const PYTH_ETH_USD_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const API3_ETH_USD_PROXY = "0x5b0cf2b36a65a6BB085D501B971e4c102B9Cd473"; // API3 ETH/USD dAPI proxy (Sepolia)
  // Official 1inch Aqua/SwapVM entrypoint. Re-verify against 1inch docs at live deploy.
  const AQUA_SWAPVM = "0x111111338c5091E8440b67B168bAe16a668AC0De";

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
  const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000"; // Arc USDC ERC-20 interface (6 dec)
  let quoteAddr: string;
  if (network === "sepolia") {
    quoteAddr = SEPOLIA_USDC;
    console.log(`Using Circle test USDC (Sepolia): ${quoteAddr}`);
  } else if (network === "arc") {
    quoteAddr = ARC_USDC_ERC20;
    console.log(`Using Arc native USDC (ERC-20 interface, 6 dec): ${quoteAddr}`);
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

  // 24h: Sepolia's API3/Pyth dAPIs update on a slow testnet cadence; a tight
  // window leaves only Chainlink fresh (< 2 valid oracles → batch voids).
  console.log("Setting maxStaleness = 86400s...");
  await (await aegis.setMaxStaleness(86400)).wait();

  // ── 1inch Aqua router (uncrossed-remainder routing) ──────────────────────────
  const aquaRouterDeploy = await deploy("AquaRouter", {
    from: deployer,
    args: [AQUA_SWAPVM],
    log: true,
    autoMine: true,
  });
  console.log(`AquaRouter deployed at: ${aquaRouterDeploy.address} (SwapVM: ${AQUA_SWAPVM})`);
  console.log("Wiring AquaRouter into AegisV4 via setAquaRouter...");
  await (await aegis.setAquaRouter(aquaRouterDeploy.address)).wait();

  // ── Oracle registration ─────────────────────────────────────────────────────
  if (network === "sepolia") {
    console.log("Deploying fresh oracle adapters + registering real oracles on Sepolia...");

    const pythAdapter = await deploy("PythOracleAdapter", {
      from: deployer,
      args: [PYTH_SEPOLIA, PYTH_ETH_USD_ID],
      log: true,
      autoMine: true,
    });
    const api3Adapter = await deploy("API3OracleAdapter", {
      from: deployer,
      args: [API3_ETH_USD_PROXY],
      log: true,
      autoMine: true,
    });

    console.log(`  Registering Chainlink ETH/USD (stack 1): ${CHAINLINK_ETH_USD}`);
    await (await aegis.registerOracle(CHAINLINK_ETH_USD, 1)).wait();

    console.log(`  Registering PythOracleAdapter (stack 2): ${pythAdapter.address}`);
    await (await aegis.registerOracle(pythAdapter.address, 2)).wait();

    console.log(`  Registering API3OracleAdapter (stack 3): ${api3Adapter.address}`);
    await (await aegis.registerOracle(api3Adapter.address, 3)).wait();

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
  console.log(`  AquaRouter: ${aquaRouterDeploy.address}`);
  console.log(`  baseAsset:  ${baseAddr}  (WETH)`);
  console.log(`  quoteAsset: ${quoteAddr}  (USDC)`);
  if (network === "sepolia") {
    console.log(`  Oracles:    Chainlink(1) + Pyth(2) + API3(3)  [fresh adapters]`);
  } else {
    console.log(`  Oracles:    MockOracleV4_1(1) + MockOracleV4_2(2)`);
  }
  console.log("=".repeat(70) + "\n");
};

export default deployAegisV4;
deployAegisV4.tags = ["AegisV4"];
