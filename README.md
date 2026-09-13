# Aegis — Secure Settlement Infrastructure for Agentic Payments

> **ETHOnline 2026 · Continuity Track.** Extending the live, verified Aegis V3 MEV-resistant
> batch-settlement engine into the safe-execution layer for agentic payments — the rails that
> keep autonomous agents from getting front-run or price-manipulated when they move value onchain.

Everyone is racing to give agents wallets. Nobody is making sure agents do not get robbed when they spend.
An autonomous agent's onchain moves are predictable and mempool-visible — a perfect sandwich and
oracle-manipulation target. Aegis is the guardrail layer: an agent submits a payment intent, and
Aegis settles it in a batch at one uniform clearing price (nothing to front-run), priced from
multiple independent oracles (nothing to manipulate), driven end-to-end by an autonomous agent
on the Circle Agent Stack, settling in native USDC — zero human in the loop.

## Live deployments

| | Address / link |
|---|---|
| **AegisV4 — Ethereum Sepolia** (verified) | [`0x0a16364229EeFDA44332cB6D194E20937C51CE5b`](https://sepolia.etherscan.io/address/0x0a16364229EeFDA44332cB6D194E20937C51CE5b) |
| **AegisV4 — Circle Arc testnet** | [`0xf520B2eE9AD41BA0AD1Ba313ce25dfa0f1361fB8`](https://testnet.arcscan.app/address/0xf520B2eE9AD41BA0AD1Ba313ce25dfa0f1361fB8) |
| **The Graph subgraph** | [Studio query endpoint](https://api.studio.thegraph.com/query/1758636/aegis-solver/v0.1.0) |
| **Solver Agent** | [`agent/`](./agent) |
| **AegisV3 — pre-existing base** (untouched) | [`0xe8C3672A7348Fe8fF81814C42f1bf411D69C39b1`](https://sepolia.etherscan.io/address/0xe8C3672A7348Fe8fF81814C42f1bf411D69C39b1) |

**Autonomous USDC settlement proven on both chains** (5 USDC settled agent to counterparty, zero human calls):

- **Arc** (native USDC): deposit [`0xad1ac733`](https://testnet.arcscan.app/tx/0xad1ac7330a0e7a2d829b859ae79d2b9b1a276663573ccbf06d80883b76a0b2c3) → executeSettlement [`0x614475f5`](https://testnet.arcscan.app/tx/0x614475f587a64653c209660a25ee7bc875a5fd11280e66253ad2236f282d49c9) → seller receives 5 USDC [`0xd83380f5`](https://testnet.arcscan.app/tx/0xd83380f55f3c74766d637299f98cadd435844403a079eb223d0044dd4fd2dee1)
- **Sepolia** (Chainlink + API3 feeds): executeSettlement [`0xdaebdf49`](https://sepolia.etherscan.io/tx/0xdaebdf494e0d091c1fc83adfa5253869ea9ac5d98d6d560f7463d5ef8eac014e) → seller receives USDC [`0x6607b899`](https://sepolia.etherscan.io/tx/0x6607b899b6851cb027d1b017b83098bdfcb49e00a38b89f65b203f392e05e9bc)
- Full tx sets: [`agent/settlement-evidence.arc.json`](./agent/settlement-evidence.arc.json) · [`agent/settlement-evidence.sepolia.json`](./agent/settlement-evidence.sepolia.json)

## Continuity disclosure

This is a Continuity track submission. The repository is built on Scaffold-ETH 2 (which accounts for
the contributor count and the pre-hackathon git history). All ETHOnline work is on the `ethonline`
branch, authored solely by Parth Arvind Rathi, starting September 4 2026.

| | Work |
|---|---|
| **Pre-existing** | `AegisV3.sol` — live, verified, untouched. 4-phase batch lifecycle, multi-oracle dynamic weighting, MEV-resistant uniform-price settlement. |
| **New this hackathon** | `AegisV4` real two-asset swap (WETH/USDC); real Chainlink + Pyth + API3 oracle adapters; The Graph subgraph; autonomous Solver Agent on the Circle Agent Stack with native USDC settlement on Arc; configurable phase durations; `AgentPaymentIntent` adapter; `AquaRouter` (1inch SwapVM); `BatchAuction` Uniswap v4-hook primitive. |

## Sponsor integrations

Each integration below is load-bearing — remove it and a concrete part of the settlement flow stops working.

| Sponsor | How Aegis uses it | Where |
|---|---|---|
| **The Graph** | The agent's live data source **and decision input**: it reads oracle-reliability history from the subgraph and refuses to commit funds unless enough oracles have been reliably valid. Remove the subgraph and the agent is blind. | [`subgraph/`](./subgraph) · [`agent/src/analytics.ts`](./agent/src/analytics.ts) |
| **Circle / Arc** | The solver runs on the Circle Agent Stack (developer-controlled wallet) and settles in **native USDC on Arc** — where USDC is the gas token, so the agent operates entirely in USDC. Every crank/deposit/settlement is Circle-signed; 5 USDC settled agent→counterparty on Arc testnet with zero human calls. | [`agent/src/circle.ts`](./agent/src/circle.ts) |
| **Chainlink** | A live Chainlink ETH/USD Data Feed (oracle stack 1, consumed directly via `latestRoundData()`) drives the onchain settlement clearing price — a real state-change improvement over the pre-existing mock-oracle project. | [`packages/hardhat/contracts/AegisV4.sol`](./packages/hardhat/contracts/AegisV4.sol) |

Also built and tested but not entered (3-track limit): **1inch** and **Uniswap**.

## How it works

```
 USERS / AGENTS submit intents (BUY/SELL)  ───►  Aegis batch (onchain)
                                                          │
                                             ┌────────────▼────────────┐
                                             │      SOLVER AGENT       │  (Circle Agent Stack)
                                             │  drives the 4-phase crank:
                                             │  1. read state from The Graph
                                             │  2. collectOraclePrices() from live feeds
                                             │  3. compute fair uniform clearing price
                                             │  4. executeSettlement() onchain
                                             └────────────┬────────────┘
                                                          │
                                        settle WETH/USDC swap in native USDC (Arc)
                                                          │
                                               users receive fair fills
```

The 4-phase lifecycle (`OPEN → ACCUMULATING → DISPUTING → SETTLING`) is permissionless — any caller
can advance each phase once its block window elapses. The agent is the caller. Phase durations are
owner-configurable so the protocol works on both Ethereum (~12s blocks) and fast chains like Arc (~0.56s blocks).

## Contract addresses (Sepolia — all verified)

| Contract | Address |
|---|---|
| AegisV4 (settlement) | `0x0a16364229EeFDA44332cB6D194E20937C51CE5b` |
| AquaRouter (1inch SwapVM adapter) | `0x84FEd796f2533282C34BF8e5e9815d9f460c73D4` |
| MockWETH (base asset) | `0xDd27A82485fd77f4eEF95d0876918B723893B36D` |
| USDC (quote asset, Circle test) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Chainlink ETH/USD (stack 1) | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| PythOracleAdapter (stack 2) | `0x6D6a3A5259337139149e1f368811B715f97C7F87` |
| API3OracleAdapter (stack 3) | `0x3FabF9780667833f5A5B3FEF433649E24949D894` |

## Repository layout

```
packages/hardhat/          contracts (AegisV4.sol, adapters, AquaRouter, BatchAuction), tests, deploy
packages/nextjs/           dashboard (batch status, deposit, dispute, claim, oracle monitor)
subgraph/                  The Graph subgraph — indexes all batch/oracle/settlement events
agent/                     autonomous Solver Agent (TypeScript + Vitest, 42 tests green)
```

## Quick start

```bash
yarn install

# Contracts (from packages/hardhat/)
yarn test                    # Hardhat + Mocha/Chai

# Frontend
yarn start                   # localhost:3000/aegis — connect MetaMask to Sepolia

# Agent (from agent/)
yarn test                    # Vitest unit tests
cp .env.example .env         # fill RPC_URL + AEGIS_ADDRESS + SUBGRAPH_URL + Circle creds
yarn start                   # autonomous solver tick loop against Sepolia
```

## Stack

Scaffold-ETH 2 (Next.js 14, Wagmi, Viem) · Solidity 0.8 · Hardhat + Mocha/Chai + ethers v6 ·
TypeScript + Vitest · The Graph (subgraph indexing) · Circle Agent Stack (developer-controlled wallet) ·
Chainlink Data Feeds · Pyth · API3 · 1inch SwapVM (AquaRouter)
