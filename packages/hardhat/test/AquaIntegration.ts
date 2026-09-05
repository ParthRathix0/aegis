import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

// Deterministic (non-fork) integration test for AegisV4 -> AquaRouter -> (Aqua venue) routing of the
// uncrossed batch remainder. Uses a MockAquaVenue in place of the real 1inch SwapVM so the full
// money-path (route uncrossed volume, escrow the fill, pay the uncrossed side at market on claim)
// is exercised in CI without a mainnet fork or a live ONEINCH_API_KEY. The AquaRouter.fork.ts test
// covers routeExactIn against a live onchain venue.

async function erc20(dec: number) {
  const F = await ethers.getContractFactory("MockERC20");
  return F.deploy("Tok", "TOK", dec);
}

async function deployV4WithOracles(price: bigint) {
  const base = await erc20(18); // WETH 18-dec
  const quote = await erc20(6); // USDC 6-dec
  const V4 = await ethers.getContractFactory("AegisV4");
  const aegis = await V4.deploy(await base.getAddress(), await quote.getAddress());
  const MockOracle = await ethers.getContractFactory("MockOracle");
  for (let i = 0; i < 2; i++) {
    const o = await MockOracle.deploy(price);
    await aegis.registerOracle(await o.getAddress(), i + 1);
  }
  return { aegis, base, quote };
}

async function crankBatch0(aegis: any) {
  await mine(50);
  await aegis.startAccumulation();
  await mine(4);
  await aegis.collectOraclePrices();
  await mine(4);
  await aegis.collectOraclePrices();
  await mine(48);
  await aegis.startDispute();
  await mine(15);
  await aegis.startSettling();
  await mine(10);
  await aegis.executeSettlement();
}

describe("AegisV4 <-> 1inch Aqua uncrossed routing", function () {
  const price2000 = 200000000000n; // 2000e8

  it("routes the uncrossed SELL remainder to Aqua; seller is filled in quote, not refunded base", async function () {
    const [owner, buyer, seller] = await ethers.getSigners();
    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    // buyer 4000 USDC (= 2 WETH), seller 3 WETH -> 1 WETH uncrossed on the sell side.
    const buyerDeposit = 4000n * 10n ** 6n;
    const sellerDeposit = 3n * 10n ** 18n;
    await quote.mint(buyer.address, buyerDeposit);
    await base.mint(seller.address, sellerDeposit);
    await quote.connect(buyer).approve(aegisAddr, buyerDeposit);
    await base.connect(seller).approve(aegisAddr, sellerDeposit);
    await aegis.connect(buyer).deposit(buyerDeposit, 0); // BUY
    await aegis.connect(seller).deposit(sellerDeposit, 1); // SELL

    await crankBatch0(aegis);

    // Deploy the Aqua venue + router, wire into Aegis.
    const Venue = await ethers.getContractFactory("MockAquaVenue");
    const venue = await Venue.deploy();
    const Router = await ethers.getContractFactory("AquaRouter");
    const router = await Router.deploy(await venue.getAddress());
    const routerAddr = await router.getAddress();
    await aegis.connect(owner).setAquaRouter(routerAddr);

    // Uncrossed remainder = 1 WETH; the venue swaps it to 2000 USDC at $2000. Fund the venue.
    const uncrossedBase = 1n * 10n ** 18n;
    const aquaQuoteOut = 2000n * 10n ** 6n;
    await quote.mint(await venue.getAddress(), aquaQuoteOut);

    // Solver-supplied calldata: venue.swap(base, quote, 1 WETH, 2000 USDC, to=router).
    const aquaCalldata = venue.interface.encodeFunctionData("swap", [
      await base.getAddress(),
      await quote.getAddress(),
      uncrossedBase,
      aquaQuoteOut,
      routerAddr,
    ]);

    await expect(aegis.routeUncrossedToAqua(0, aquaQuoteOut, aquaCalldata))
      .to.emit(aegis, "UncrossedRouted")
      .withArgs(0, false, uncrossedBase, aquaQuoteOut);

    const fill = await aegis.aquaFills(0);
    expect(fill.routed).to.equal(true);
    expect(fill.sideBuy).to.equal(false);
    expect(fill.out).to.equal(aquaQuoteOut);

    // Claims.
    await aegis.connect(buyer).claim(0);
    await aegis.connect(seller).claim(0);

    // Buyer fully matched: 2 WETH, no refund.
    expect(await base.balanceOf(buyer.address)).to.equal(2n * 10n ** 18n);
    expect(await quote.balanceOf(buyer.address)).to.equal(0n);

    // Seller: 4000 USDC matched + 2000 USDC Aqua fill = 6000 USDC; NO base refund.
    expect(await quote.balanceOf(seller.address)).to.equal(6000n * 10n ** 6n);
    expect(await base.balanceOf(seller.address)).to.equal(0n);

    // Contract fully drained (solvent, exact).
    expect(await base.balanceOf(aegisAddr)).to.equal(0n);
    expect(await quote.balanceOf(aegisAddr)).to.equal(0n);
  });

  it("reverts routing when minOut is not met", async function () {
    const [owner, buyer, seller] = await ethers.getSigners();
    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    await quote.mint(buyer.address, 4000n * 10n ** 6n);
    await base.mint(seller.address, 3n * 10n ** 18n);
    await quote.connect(buyer).approve(aegisAddr, 4000n * 10n ** 6n);
    await base.connect(seller).approve(aegisAddr, 3n * 10n ** 18n);
    await aegis.connect(buyer).deposit(4000n * 10n ** 6n, 0);
    await aegis.connect(seller).deposit(3n * 10n ** 18n, 1);
    await crankBatch0(aegis);

    const Venue = await ethers.getContractFactory("MockAquaVenue");
    const venue = await Venue.deploy();
    const Router = await ethers.getContractFactory("AquaRouter");
    const router = await Router.deploy(await venue.getAddress());
    await aegis.connect(owner).setAquaRouter(await router.getAddress());

    const poorOut = 100n * 10n ** 6n; // venue only delivers 100 USDC
    await quote.mint(await venue.getAddress(), poorOut);
    const aquaCalldata = venue.interface.encodeFunctionData("swap", [
      await base.getAddress(),
      await quote.getAddress(),
      1n * 10n ** 18n,
      poorOut,
      await router.getAddress(),
    ]);

    // Demand 2000 USDC but venue only pays 100 -> AquaRouter reverts "Insufficient output".
    await expect(
      aegis.routeUncrossedToAqua(0, 2000n * 10n ** 6n, aquaCalldata),
    ).to.be.revertedWith("Insufficient output");
  });

  it("only owner can set the Aqua router; routing requires it set", async function () {
    const [, notOwner] = await ethers.getSigners();
    const { aegis } = await deployV4WithOracles(price2000);

    await expect(aegis.connect(notOwner).setAquaRouter(notOwner.address)).to.be.reverted;
    // No router set and batch not settled -> guard fires.
    await expect(aegis.routeUncrossedToAqua(0, 0, "0x")).to.be.revertedWith("Aqua router unset");
  });
});
