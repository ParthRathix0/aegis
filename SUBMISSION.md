# ETHOnline 2026 — Aegis Submission Draft (Continuity track)

Copy-paste source for the ETHGlobal Showcase form. Written in the **agentic-payments** framing
(precise claim scope: the surface is agent *value movement* — swaps / conversions / settlement —
not plain transfers). Fill the `____` links at the final-deploy pass.

---

## Project name
**Aegis — Secure Settlement Infrastructure for Agentic Payments**

## Short description (tagline)
The safe-execution layer for agentic payments: autonomous agents settle onchain trades at one fair,
front-run-proof price — priced by three independent oracles, run by an agent, in native USDC on Arc.

## The problem it solves
Everyone in 2026 is racing to give agents wallets and the ability to pay. Almost no one is making it
**safe**. An autonomous agent's onchain behavior is predictable and mempool-visible, so every swap or
value-conversion it performs is a prime target for sandwich bots and oracle manipulation — the agent
overpays, silently, forever, because it can't see the attack. We're building agents that *can* pay;
nobody is building the rails that keep them from getting robbed when they do.

Aegis is that guardrail layer. Instead of firing a raw swap into the mempool, an agent submits a
**payment intent**. Aegis:
- settles it in a **batch at one uniform clearing price** — there is nothing to front-run or sandwich;
- prices every settlement from **three independent oracles** (Chainlink + Pyth + API3) with
  confidence-weighted aggregation — no single feed can be gamed;
- runs the entire settlement lifecycle with an **autonomous agent** on the Circle stack, settling in
  **native USDC on Arc**;
- routes overflow/uncrossed liquidity to **1inch Aqua**, and exposes all live state through a
  **Graph subgraph** that is the agent's eyes.

Agent + infra: not another agent that pays, but the settlement rails every paying agent needs.

## How it's made
Aegis extends a live, verified pre-existing project — **Aegis V3**, an MEV-resistant batch-settlement
engine on Ethereum Sepolia — into an autonomous, real-oracle, real-two-asset settlement network.

- **Contracts (Solidity, Hardhat):** `AegisV4` forks V3 into a real two-asset swap (BASE/WETH vs
  QUOTE/USDC) settled at the oracle clearing price, with a provably-solvent pro-rata payout. Fair
  uniform-price matching is extracted into a reusable `BatchAuction` v4-hook primitive. `AquaRouter`
  forwards uncrossed remainder to the official 1inch SwapVM.
- **Oracles:** the pre-existing mock oracles are replaced with **live Chainlink + Pyth + API3 ETH/USD
  feeds** (adapters expose the Chainlink `latestRoundData()` interface); `maxStaleness` is
  owner-configurable for real testnet heartbeats.
- **Subgraph (The Graph):** indexes every batch/order/oracle/settlement event; it is load-bearing —
  the agent reads phase and market state from it.
- **Solver Agent (TypeScript, Circle Agent Stack):** a pure `decideAction` core drives the 4-phase
  permissionless crank end-to-end; writes route through a Circle developer-controlled wallet, settling
  in native USDC on Arc. An `AgentPaymentIntent` adapter frames agent orders as payment intents.
- **Stack:** Scaffold-ETH 2 (Next.js, Wagmi, Viem), Hardhat + Mocha/Chai + ethers v6, Vitest.

## Continuity disclosure (pre-existing vs. new)
- **Pre-existing (before the hackathon):** Aegis V3 — live & verified on Sepolia
  (`0xe8C3672A7348Fe8fF81814C42f1bf411D69C39b1`): 4-phase batch lifecycle, multi-oracle dynamic
  weighting, MEV-resistant uniform-price settlement. `AegisV3.sol` is **untouched** as continuity
  evidence.
- **New (during the hackathon, branch `ethonline`, granular commit history):** real Chainlink/Pyth/API3
  feeds; `AegisV4` two-asset swap; The Graph subgraph; the autonomous Solver Agent + Circle/Arc USDC
  settlement; 1inch Aqua routing; Uniswap `BatchAuction` hook primitive + `FEEDBACK.md`; the
  agentic-payments reframe (`AgentPaymentIntent`).

## Links
- **Source code:** https://github.com/ParthRathix0/IIT-Trihacker-Finale (branch `ethonline`)
- **Demo video:** ____
- **Live AegisV4 (Sepolia, verified):** https://sepolia.etherscan.io/address/0x0a16364229EeFDA44332cB6D194E20937C51CE5b
- **Subgraph (Studio query URL):** https://api.studio.thegraph.com/query/1758636/aegis-solver/v0.1.0

### Live Circle-driven USDC settlement (Sepolia — proof for Arc/Circle)
An autonomous agent drove a full batch to settlement end-to-end via the **Circle Agent Stack**
(zero human calls). The Circle wallet (`0xd503…57fd`) deposited USDC and signed every crank; a
counterparty sold WETH; the batch settled and USDC was paid out on claim.
- Circle **USDC deposit** (BUY payment intent): [`0x30472aee`](https://sepolia.etherscan.io/tx/0x30472aee172aabc93e47e3ac2e866e25f2375d7f12faaf2c63dd41c10d6ec2c4)
- Circle-signed **executeSettlement**: [`0xdaebdf49`](https://sepolia.etherscan.io/tx/0xdaebdf494e0d091c1fc83adfa5253869ea9ac5d98d6d560f7463d5ef8eac014e)
- **Seller receives USDC** on claim: [`0x6607b899`](https://sepolia.etherscan.io/tx/0x6607b899b6851cb027d1b017b83098bdfcb49e00a38b89f65b203f392e05e9bc)
- Circle claim (BUY side receives WETH): [`0xbb5fbf44`](https://sepolia.etherscan.io/tx/0xbb5fbf4470d42d44cbaacdaf2f13052d6030436d6f40a9fef22c25d6294e2785)
- Full hash set: `agent/settlement-evidence.json`
- Note: this proves the Circle+USDC path; the **Arc-chain** re-run (same flow, `rpc.testnet.arc.io`) is the final Arc-prize artifact.

### Live Circle-driven USDC settlement ON ARC (the Arc-prize artifact)
The same autonomous flow, re-run natively on **Circle Arc testnet** (chain 5042002, USDC-native gas).
The Circle Agent Stack wallet (`0xd503…57fd`, Arc walletId `dfc276c8…`) deposited USDC and signed
every crank; the batch settled at $2000 and **5 USDC moved to the counterparty** (verified via the
`Claimed` events). Aegis phase durations were made owner-configurable to fit Arc's ~0.56s blocks.
- **AegisV4 on Arc:** `0xf520B2eE9AD41BA0AD1Ba313ce25dfa0f1361fB8`
- Circle **USDC deposit** on Arc: `0xad1ac7330a0e7a2d829b859ae79d2b9b1a276663573ccbf06d80883b76a0b2c3`
- Circle **executeSettlement** on Arc: `0x614475f587a64653c209660a25ee7bc875a5fd11280e66253ad2236f282d49c9`
- **Seller receives 5 USDC** (`Claimed filled=5000000`): `0xd83380f55f3c74766d637299f98cadd435844403a079eb223d0044dd4fd2dee1`
- Explorer: https://testnet.arcscan.app · full hashes: `agent/settlement-evidence.arc.json`

### Canonical Sepolia addresses (final deploy — all verified)
| Contract | Address |
|---|---|
| AegisV4 (settlement) | `0x0a16364229EeFDA44332cB6D194E20937C51CE5b` |
| AquaRouter (1inch SwapVM) | `0x84FEd796f2533282C34BF8e5e9815d9f460c73D4` |
| MockWETH (base) | `0xDd27A82485fd77f4eEF95d0876918B723893B36D` |
| USDC (quote, Circle test) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Chainlink ETH/USD (stack 1) | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| PythOracleAdapter (stack 2) | `0x6D6a3A5259337139149e1f368811B715f97C7F87` |
| API3OracleAdapter (stack 3) | `0x3FabF9780667833f5A5B3FEF433649E24949D894` |

---

## Per-sponsor continuity notes (paste into each prize)

**The Graph — AI Tooling ($5,000):** The subgraph is the agent's live data source — it reads batch
phase and market state from the subgraph to decide the next crank action. Without it, the agent is
blind and nothing settles. Load-bearing, not decorative. (`subgraph/QUERIES.md`.)

**1inch — Aqua ($2,000):** `AquaRouter` forwards the batch's uncrossed remainder to the official
1inch SwapVM; the uncrossed side is paid the Aqua fill (provably solvent, `nonReentrant`). The agent
fetches an Aqua quote and routes post-settlement.

**Uniswap Foundation — Stack ($2,000):** Fair batch-auction settlement extracted as a reusable
`BatchAuction` v4-hook primitive; `FEEDBACK.md` documents the v4 hook-interface usage + a concrete
batch-settlement-hook improvement.

**Arc (Circle) — Agentic ($1,666):** The solver is built on the Circle Agent Stack (developer-controlled
wallet) and settles agentic payments in **native USDC on Arc** — the literal agentic-payments rail this
whole project is about. Every crank/settlement write routes through the Circle wallet.

**Chainlink — Continuity ($500):** Replaced 5 mock oracles with a live Chainlink ETH/USD Data Feed
(oracle id 1) that contributes to the onchain settlement price — a real state-change improvement over
the pre-existing mock-oracle project.
