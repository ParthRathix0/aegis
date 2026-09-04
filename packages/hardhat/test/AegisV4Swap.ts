import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

async function erc20(dec: number) {
  const F = await ethers.getContractFactory("MockERC20");
  return F.deploy("Tok", "TOK", dec);
}

describe("AegisV4 two-asset deposit", function () {
  it("pulls quote on BUY", async function () {
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

  it("pulls base on SELL", async function () {
    const [user] = await ethers.getSigners();
    const base = await erc20(18);
    const quote = await erc20(6);
    const V4 = await ethers.getContractFactory("AegisV4");
    const aegis = await V4.deploy(await base.getAddress(), await quote.getAddress());

    await base.mint(user.address, 5n * 10n ** 18n);
    await base.approve(await aegis.getAddress(), 5n * 10n ** 18n);
    await aegis.deposit(5n * 10n ** 18n, 1); // SELL -> pulls base

    expect(await base.balanceOf(await aegis.getAddress())).to.equal(5n * 10n ** 18n);
  });
});

// ===== Helper: deploy AegisV4 + 2 oracles at a given price =====
async function deployV4WithOracles(price: bigint) {
  const base = await erc20(18);   // WETH 18-dec
  const quote = await erc20(6);   // USDC 6-dec
  const V4 = await ethers.getContractFactory("AegisV4");
  const aegis = await V4.deploy(await base.getAddress(), await quote.getAddress());

  const MockOracle = await ethers.getContractFactory("MockOracle");
  for (let i = 0; i < 2; i++) {
    const o = await MockOracle.deploy(price);
    await aegis.registerOracle(await o.getAddress(), i + 1);
  }
  return { aegis, base, quote };
}

// ===== Helper: crank through the full lifecycle of batch 0 =====
// Durations: OPEN 50, ACCUM 48, DISPUTE 15, SETTLING 10
// collectOraclePrices requires COLLECTION_INTERVAL=4 blocks between calls
async function crankBatch0(aegis: any) {
  // Mine past OPEN_DURATION (50 blocks)
  await mine(50);
  await aegis.startAccumulation();

  // Two collection rounds during ACCUMULATION (48 blocks total)
  await mine(4);
  await aegis.collectOraclePrices();
  await mine(4);
  await aegis.collectOraclePrices();

  // Mine past accumulationEnd
  await mine(48);
  await aegis.startDispute();    // computes settlement price

  // Mine past DISPUTE_DURATION (15 blocks)
  await mine(15);
  await aegis.startSettling();

  // Mine past SETTLING_DURATION (10 blocks)
  await mine(10);
  await aegis.executeSettlement();  // settles batch 0, creates batch 1
}

describe("AegisV4 settlement", function () {
  // ---- Test 1: Fully matched batch ----
  it("fully matched: BUY gets exact base (WETH), SELL gets exact quote (USDC)", async function () {
    const [, buyer, seller] = await ethers.getSigners();
    const price2000 = 200000000000n; // 2000e8

    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    // buyer deposits 4000 USDC (6-dec); seller deposits 2 WETH (18-dec)
    // At $2000/WETH: 4000 USDC = exactly 2 WETH -> fully matched
    const buyerDeposit = 4000n * 10n ** 6n;   // 4000 USDC
    const sellerDeposit = 2n * 10n ** 18n;    // 2 WETH

    await quote.mint(buyer.address, buyerDeposit);
    await base.mint(seller.address, sellerDeposit);
    await quote.connect(buyer).approve(aegisAddr, buyerDeposit);
    await base.connect(seller).approve(aegisAddr, sellerDeposit);

    // Deposits target currentBatchId = 0 (created by constructor)
    await aegis.connect(buyer).deposit(buyerDeposit, 0);   // BUY
    await aegis.connect(seller).deposit(sellerDeposit, 1); // SELL

    // Run the full lifecycle for batch 0
    await crankBatch0(aegis);

    // Batch 0 should now be settled; batch 1 is the new current batch
    // Claim from batch 0
    await aegis.connect(buyer).claim(0);
    await aegis.connect(seller).claim(0);

    const buyerBase = await base.balanceOf(buyer.address);
    const sellerQuote = await quote.balanceOf(seller.address);

    // Fully matched: buyer receives exactly 2 WETH, seller receives exactly 4000 USDC
    expect(buyerBase).to.equal(2n * 10n ** 18n, "buyer should receive 2 WETH");
    expect(sellerQuote).to.equal(4000n * 10n ** 6n, "seller should receive 4000 USDC");

    // No refunds: buyer's quote balance == 0, seller's base balance == 0
    expect(await quote.balanceOf(buyer.address)).to.equal(0n, "buyer quote refund should be 0");
    expect(await base.balanceOf(seller.address)).to.equal(0n, "seller base refund should be 0");
  });

  // ---- Test 2: Partially matched batch ----
  it("partially matched: buyer fills fully, excess seller gets base refund", async function () {
    const [, buyer, seller] = await ethers.getSigners();
    const price2000 = 200000000000n; // 2000e8

    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    // buyer deposits 4000 USDC (= 2 WETH at $2000)
    // seller deposits 3 WETH (= 6000 USDC worth at $2000) -> OVER-supply
    // fill ratio: buyVol=4000e6 USDC, sellVolInQuote=3*2000e6=6000e6 USDC
    //   buyFillRatio = PRECISION (buyer fully filled, 2/3 of sellVol matched)
    //   sellFillRatio = buyVol / sellVolInQuote = 4000/6000 * PRECISION = 2/3 PRECISION
    const buyerDeposit = 4000n * 10n ** 6n;   // 4000 USDC
    const sellerDeposit = 3n * 10n ** 18n;    // 3 WETH

    await quote.mint(buyer.address, buyerDeposit);
    await base.mint(seller.address, sellerDeposit);
    await quote.connect(buyer).approve(aegisAddr, buyerDeposit);
    await base.connect(seller).approve(aegisAddr, sellerDeposit);

    await aegis.connect(buyer).deposit(buyerDeposit, 0);   // BUY
    await aegis.connect(seller).deposit(sellerDeposit, 1); // SELL

    await crankBatch0(aegis);

    await aegis.connect(buyer).claim(0);
    await aegis.connect(seller).claim(0);

    const buyerBase  = await base.balanceOf(buyer.address);
    const buyerQuote = await quote.balanceOf(buyer.address);
    const sellerQuote = await quote.balanceOf(seller.address);
    const sellerBase  = await base.balanceOf(seller.address);

    // Buyer: fully filled -> receives 2 WETH, 0 USDC refund
    expect(buyerBase).to.equal(2n * 10n ** 18n, "buyer should receive 2 WETH");
    expect(buyerQuote).to.equal(0n, "buyer should have 0 USDC refund");

    // Seller: 2/3 filled
    //   filledIn = 3e18 * (4000e6 / 6000e6) = 2e18 WETH
    //   quoteOut = 2e18 * 2000e8 / 1e20 = 4000e6 USDC
    //   refundIn = 3e18 - 2e18 = 1e18 WETH
    expect(sellerQuote).to.equal(4000n * 10n ** 6n, "seller should receive 4000 USDC");
    // closeTo to allow 1-wei rounding
    expect(sellerBase).to.be.closeTo(1n * 10n ** 18n, 1n, "seller should receive ~1 WETH refund");
  });

  // ---- Test 3: Multi-party, sell-oversubscribed (the bug repro) ----
  it("multi-party sell-oversubscribed: 1 buyer + 2 sellers all claim without revert (solvent)", async function () {
    const [, buyer, seller1, seller2] = await ethers.getSigners();
    const price2000 = 200000000000n; // 2000e8

    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    const buyerDeposit = 4000n * 10n ** 6n; // 4000 USDC = 2 WETH worth
    const seller1Deposit = 1n * 10n ** 18n; // 1 WETH
    const seller2Deposit = 2n * 10n ** 18n; // 2 WETH -> total sell 3 WETH (6000 USDC), over-supply

    await quote.mint(buyer.address, buyerDeposit);
    await base.mint(seller1.address, seller1Deposit);
    await base.mint(seller2.address, seller2Deposit);
    await quote.connect(buyer).approve(aegisAddr, buyerDeposit);
    await base.connect(seller1).approve(aegisAddr, seller1Deposit);
    await base.connect(seller2).approve(aegisAddr, seller2Deposit);

    await aegis.connect(buyer).deposit(buyerDeposit, 0); // BUY
    await aegis.connect(seller1).deposit(seller1Deposit, 1); // SELL
    await aegis.connect(seller2).deposit(seller2Deposit, 1); // SELL

    await crankBatch0(aegis);

    // ALL THREE must claim successfully — this is the case that reverted before the fix.
    await expect(aegis.connect(buyer).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(seller1).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(seller2).claim(0)).to.not.be.reverted;

    const buyerBase = await base.balanceOf(buyer.address);
    const s1Quote = await quote.balanceOf(seller1.address);
    const s2Quote = await quote.balanceOf(seller2.address);
    const s1Base = await base.balanceOf(seller1.address);
    const s2Base = await base.balanceOf(seller2.address);

    // Buyer fully matched -> ~2 WETH
    expect(buyerBase).to.be.closeTo(2n * 10n ** 18n, 2n, "buyer should receive ~2 WETH");

    // Sellers get pro-rata quote (matched 4000 USDC across 3 WETH sell volume):
    //   s1 quoteOut = 1e18 * 4000e6 / 3e18, s2 quoteOut = 2e18 * 4000e6 / 3e18
    // and base refund of their share of the unmatched 1 WETH.
    expect(s1Quote + s2Quote).to.be.lte(4000n * 10n ** 6n, "sellers' quote out must not exceed buyer deposit");
    // Each seller's base refund is proportional to unmatched base (1 WETH total).
    expect(s1Base).to.be.closeTo((1n * 10n ** 18n) / 3n, 2n, "seller1 base refund ~1/3 WETH");
    expect(s2Base).to.be.closeTo((2n * 10n ** 18n) / 3n, 2n, "seller2 base refund ~2/3 WETH");

    // Solvency: contract balances never went negative (no revert) and remain >= 0.
    expect(await base.balanceOf(aegisAddr)).to.be.gte(0n);
    expect(await quote.balanceOf(aegisAddr)).to.be.gte(0n);
  });

  // ---- Test 4: Multi-party, buy-oversubscribed ----
  it("multi-party buy-oversubscribed: 2 buyers + 1 seller all claim without revert (solvent)", async function () {
    const [, buyer1, buyer2, seller] = await ethers.getSigners();
    const price2000 = 200000000000n; // 2000e8

    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    const buyer1Deposit = 4000n * 10n ** 6n; // 4000 USDC
    const buyer2Deposit = 2000n * 10n ** 6n; // 2000 USDC -> total buy 6000 USDC, over-demand
    const sellerDeposit = 2n * 10n ** 18n; // 2 WETH = 4000 USDC worth

    await quote.mint(buyer1.address, buyer1Deposit);
    await quote.mint(buyer2.address, buyer2Deposit);
    await base.mint(seller.address, sellerDeposit);
    await quote.connect(buyer1).approve(aegisAddr, buyer1Deposit);
    await quote.connect(buyer2).approve(aegisAddr, buyer2Deposit);
    await base.connect(seller).approve(aegisAddr, sellerDeposit);

    await aegis.connect(buyer1).deposit(buyer1Deposit, 0); // BUY
    await aegis.connect(buyer2).deposit(buyer2Deposit, 0); // BUY
    await aegis.connect(seller).deposit(sellerDeposit, 1); // SELL

    await crankBatch0(aegis);

    await expect(aegis.connect(buyer1).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(buyer2).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(seller).claim(0)).to.not.be.reverted;

    const b1Base = await base.balanceOf(buyer1.address);
    const b2Base = await base.balanceOf(buyer2.address);
    const b1Quote = await quote.balanceOf(buyer1.address);
    const b2Quote = await quote.balanceOf(buyer2.address);
    const sellerQuote = await quote.balanceOf(seller.address);

    // matchedBase = 2 WETH split pro-rata by buy volume: b1 = 4000/6000, b2 = 2000/6000
    expect(b1Base + b2Base).to.be.lte(2n * 10n ** 18n, "buyers' base out must not exceed seller deposit");
    expect(b1Base).to.be.closeTo((4000n * (2n * 10n ** 18n)) / 6000n, 2n, "buyer1 base ~4/6 of 2 WETH");
    expect(b2Base).to.be.closeTo((2000n * (2n * 10n ** 18n)) / 6000n, 2n, "buyer2 base ~2/6 of 2 WETH");

    // Unmatched quote (6000-4000 = 2000 USDC) refunded pro-rata.
    expect(b1Quote + b2Quote).to.be.lte(2000n * 10n ** 6n, "quote refunds must not exceed unmatched quote");

    // Seller fully matched -> gets all matched quote (4000 USDC).
    expect(sellerQuote).to.be.closeTo(4000n * 10n ** 6n, 2n, "seller should receive ~4000 USDC");

    // Solvency.
    expect(await base.balanceOf(aegisAddr)).to.be.gte(0n);
    expect(await quote.balanceOf(aegisAddr)).to.be.gte(0n);
  });

  // ---- Test 5: Partial disputer that still settles (dispute-path solvency repro) ----
  // This is the reviewer's insolvency repro: a disputer takes the full-refund early-return
  // in claim() while the batch STILL settles (dispute ratio under the void threshold).
  // Before the fix, matched volumes were computed from GROSS volume that still included the
  // disputer's amount, so the counterparty was paid a fill against volume that was also refunded,
  // draining the pool short -> the last claimant's safeTransfer reverted (funds locked).
  it("partial disputer that still settles: all claims succeed (dispute solvency)", async function () {
    const [, buyerA, buyerB, seller] = await ethers.getSigners();
    const price2000 = 200000000000n; // 2000e8

    const { aegis, base, quote } = await deployV4WithOracles(price2000);
    const aegisAddr = await aegis.getAddress();

    const buyerADeposit = 3000n * 10n ** 6n; // 3000 USDC (will be disputed)
    const buyerBDeposit = 3000n * 10n ** 6n; // 3000 USDC
    const sellerDeposit = 3n * 10n ** 18n;   // 3 WETH = 6000 USDC worth

    await quote.mint(buyerA.address, buyerADeposit);
    await quote.mint(buyerB.address, buyerBDeposit);
    await base.mint(seller.address, sellerDeposit);
    await quote.connect(buyerA).approve(aegisAddr, buyerADeposit);
    await quote.connect(buyerB).approve(aegisAddr, buyerBDeposit);
    await base.connect(seller).approve(aegisAddr, sellerDeposit);

    await aegis.connect(buyerA).deposit(buyerADeposit, 0); // BUY
    await aegis.connect(buyerB).deposit(buyerBDeposit, 0); // BUY
    await aegis.connect(seller).deposit(sellerDeposit, 1); // SELL

    // ---- Crank with a live dispute during the DISPUTING window ----
    await mine(50);
    await aegis.startAccumulation();
    await mine(4);
    await aegis.collectOraclePrices();
    await mine(4);
    await aegis.collectOraclePrices();
    await mine(48);
    await aegis.startDispute(); // -> DISPUTING; settlementPrice set

    // buyerA disputes its own order (identified by msg.sender) during the DISPUTING phase.
    expect(await aegis.getBatchState(0)).to.equal(2); // DISPUTING
    await aegis.connect(buyerA).dispute();

    // Dispute ratio check: maxDisputed = max(3000e6, 0) = 3000e6;
    // totalVolume (quote units) = buyVol 6000e6 + sellVolInQuote 6000e6 = 12000e6;
    // ratio = 25% < DISPUTE_VOID_THRESHOLD (33%) -> batch SETTLES (not voided).
    await mine(15);
    await aegis.startSettling();
    expect(await aegis.getBatchState(0)).to.equal(3); // SETTLING, NOT voided (would be OPEN=0)

    await mine(10);
    await aegis.executeSettlement(); // settles batch 0

    // ALL THREE claims must succeed — the pre-fix repro reverted the last one.
    await expect(aegis.connect(buyerA).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(buyerB).claim(0)).to.not.be.reverted;
    await expect(aegis.connect(seller).claim(0)).to.not.be.reverted;

    // buyerA disputed -> full refund of deposited quote (3000 USDC), no WETH.
    expect(await quote.balanceOf(buyerA.address)).to.equal(buyerADeposit, "buyerA full USDC refund");
    expect(await base.balanceOf(buyerA.address)).to.equal(0n, "buyerA gets no WETH");

    // Non-disputed matching: netBuy = 3000e6, netSell = 3e18, sellVolInQuote = 6000e6,
    // matchedQuote = 3000e6 -> matchedBase = 1.5 WETH.
    // buyerB (only non-disputed buyer) gets all matchedBase = 1.5 WETH, no quote refund.
    expect(await base.balanceOf(buyerB.address)).to.be.closeTo(15n * 10n ** 17n, 2n, "buyerB ~1.5 WETH");
    expect(await quote.balanceOf(buyerB.address)).to.equal(0n, "buyerB no quote refund (fully matched)");

    // seller gets matchedQuote = 3000 USDC, base refund = 3 - 1.5 = 1.5 WETH.
    expect(await quote.balanceOf(seller.address)).to.be.closeTo(3000n * 10n ** 6n, 2n, "seller ~3000 USDC");
    expect(await base.balanceOf(seller.address)).to.be.closeTo(15n * 10n ** 17n, 2n, "seller ~1.5 WETH refund");

    // Solvency: all transfers executed without revert; residual balances non-negative.
    expect(await base.balanceOf(aegisAddr)).to.be.gte(0n);
    expect(await quote.balanceOf(aegisAddr)).to.be.gte(0n);
  });
});
