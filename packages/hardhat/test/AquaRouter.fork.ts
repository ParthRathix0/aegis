import { expect } from "chai";
import { ethers, network } from "hardhat";

/**
 * AquaRouter mainnet-fork test.
 *
 * Runs only when the Hardhat network is forking Ethereum mainnet:
 *   MAINNET_FORKING_ENABLED=true yarn test test/AquaRouter.fork.ts
 * (or `yarn fork` in Terminal A, then `--network localhost`). Skips gracefully otherwise so the
 * default `yarn test` stays green without an archive RPC.
 *
 * What it proves: AquaRouter.routeExactIn correctly (1) pulls tokenIn from the caller, (2) approves
 * and forwards opaque swap calldata to the configured venue, (3) measures the tokenOut delta,
 * (4) enforces minOut, and (5) forwards the received tokenOut back to the caller — the exact
 * mechanics used to route an uncrossed batch remainder to 1inch Aqua / SwapVM.
 *
 * Venue note: a genuine 1inch Aqua/SwapVM fill (entrypoint 0x111111338c5091E8440b67B168bAe16a668AC0De)
 * requires a maker Order discovered via the Aqua indexer/API + calldata built by the 1inch Aqua SDK,
 * which needs a live ONEINCH_API_KEY (user-owned, currently empty in .env). Because AquaRouter is
 * venue-agnostic (it forwards whatever calldata the Solver Agent supplies), we validate the router's
 * onchain mechanics here against a live mainnet DEX (Uniswap V2 Router02) as a stand-in venue. When
 * the API key + a discovered Aqua order are available, the SAME routeExactIn path is pointed at the
 * SwapVM router with Aqua-SDK calldata — no contract change (see AquaRouter.sol header).
 */

// Ethereum mainnet addresses.
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

const WETH_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const UNIV2_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])",
];

// Gate on a dedicated flag (NOT MAINNET_FORKING_ENABLED) so that config-level forking stays OFF at
// EDR startup — we switch to forking via hardhat_reset inside before(). This sidesteps the EDR 0.5.2
// fork-init panic ("Must be present as this is not a pending block") triggered when the bundled EDR
// forks a "latest"/null-totalDifficulty block at startup.
const forking = process.env.AQUA_FORK === "1";
// Pin to a fixed recent mainnet block so state is deterministic and we avoid a moving "latest".
const FORK_BLOCK = Number(process.env.AQUA_FORK_BLOCK || 21000000);
const providerApiKey = process.env.ALCHEMY_API_KEY || "cR4WnXePioePZ5fFrnSiR";

(forking ? describe : describe.skip)("AquaRouter (mainnet fork)", function () {
  this.timeout(180000);

  before(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${providerApiKey}`,
            blockNumber: FORK_BLOCK,
          },
        },
      ],
    });
  });

  it("routes WETH->USDC through the router and returns > minOut", async function () {
    const [caller] = await ethers.getSigners();

    const weth = new ethers.Contract(WETH, WETH_ABI, caller);
    const usdc = new ethers.Contract(USDC, ERC20_ABI, caller);
    const univ2 = new ethers.Interface(UNIV2_ABI);

    const amountIn = ethers.parseEther("1");

    // Fund the caller with WETH by wrapping ETH (fork accounts have plenty of ETH).
    await (await weth.deposit({ value: amountIn })).wait();

    // Deploy the router pointed at the (stand-in) venue.
    const Router = await ethers.getContractFactory("AquaRouter");
    const router = await Router.deploy(UNISWAP_V2_ROUTER);
    const routerAddr = await router.getAddress();

    // Caller approves the router to pull WETH.
    await (await weth.approve(routerAddr, amountIn)).wait();

    // Build the venue calldata: output (USDC) is sent to the router, which then forwards to caller.
    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 3600n;
    const aquaCalldata = univ2.encodeFunctionData("swapExactTokensForTokens", [
      amountIn,
      0n,
      [WETH, USDC],
      routerAddr,
      deadline,
    ]);

    // ~$2000+/ETH on any recent fork block; 1000 USDC (6dp) is a safe floor.
    const minOut = 1000n * 10n ** 6n;

    const usdcBefore = await usdc.balanceOf(caller.address);
    await (await router.routeExactIn(WETH, USDC, amountIn, minOut, aquaCalldata)).wait();
    const usdcAfter = await usdc.balanceOf(caller.address);

    const received = usdcAfter - usdcBefore;
    expect(received).to.be.greaterThanOrEqual(minOut);
  });

  it("reverts when the swap yields less than minOut", async function () {
    const [caller] = await ethers.getSigners();
    const weth = new ethers.Contract(WETH, WETH_ABI, caller);
    const univ2 = new ethers.Interface(UNIV2_ABI);

    const amountIn = ethers.parseEther("1");
    await (await weth.deposit({ value: amountIn })).wait();

    const Router = await ethers.getContractFactory("AquaRouter");
    const router = await Router.deploy(UNISWAP_V2_ROUTER);
    const routerAddr = await router.getAddress();
    await (await weth.approve(routerAddr, amountIn)).wait();

    const block = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 3600n;
    const aquaCalldata = univ2.encodeFunctionData("swapExactTokensForTokens", [
      amountIn,
      0n,
      [WETH, USDC],
      routerAddr,
      deadline,
    ]);

    // Impossibly high floor -> router must revert.
    const minOut = 10_000_000n * 10n ** 6n;
    await expect(
      router.routeExactIn(WETH, USDC, amountIn, minOut, aquaCalldata),
    ).to.be.revertedWith("Insufficient output");
  });
});
