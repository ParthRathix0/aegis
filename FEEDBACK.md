# Uniswap Stack — Developer Feedback (Aegis Solver Network, ETHOnline 2026)

Project: **Aegis** — an autonomous, MEV-resistant batch-auction solver network extending the live
Aegis V3 settlement engine. Continuity track. Repo: this repository (`ethonline` branch).

This document is our submission artifact for the **Uniswap Foundation — Stack (Continuity)** track.
It records which parts of the Uniswap stack we used/referenced, what worked, what was confusing, and
one concrete improvement suggestion.

## What we built on the Uniswap stack

Aegis settles trades in a **fair, uniform-price batch auction**: over a block window it accumulates
BUY/SELL intents, prices the batch from multiple oracles, matches the crossing volume at one honest
clearing price (killing intra-batch sandwich MEV), and routes the **uncrossed remainder** to an
external venue. That matching rule is exactly the kind of primitive a Uniswap **v4 hook** is meant to
host — a `beforeSwap`/settlement hook that batches flow and clears it at a single price instead of
executing each swap independently against the pool.

We extracted the core matching math into a **standalone, reusable, documented library** designed to
drop into a v4 hook:

- **`aegis/packages/hardhat/contracts/lib/BatchAuction.sol`** — `BatchAuction.fillRatios(buyVol,
  sellVol) -> (buyRatio, sellRatio)` (1e18-scaled). Pure, no storage, no external calls. The smaller
  side fills 100%; the larger side fills pro-rata; the uncrossed remainder is what a hook would route
  out (in our case to 1inch Aqua). Unit-tested in `test/BatchAuction.ts`, and the production settlement
  contract `AegisV4.sol` delegates its `_calculateFillRatio` to it — so the same audited primitive
  backs both the live protocol and the proposed hook.

**Reference used:** the Uniswap **v4 periphery hook interface** (`IHooks`, the `beforeSwap`/
`afterSwap`/`beforeSwapReturnDelta` surface and `BaseHook`) as the integration target for the
`BatchAuction` primitive — i.e. how a hook returns a delta so a custom settlement rule can override
the pool's default swap accounting.

## What worked well

- **v4's hook return-delta model is a genuinely good fit for batch auctions.** `beforeSwapReturnDelta`
  lets a hook take custody of the swap and settle it under its own logic — precisely what a uniform-
  price batch clearer needs. The mental model ("the hook can return a delta that adjusts the swap")
  made it clear the matching rule belongs in the hook, not forked into a bespoke pool.
- **Clean separation of concerns.** Because the fair-matching rule is pure arithmetic, extracting it
  into a dependency-free library was trivial and made it independently testable — the hook boundary
  encouraged good factoring.
- **PoolManager singleton + flash accounting** conceptually map well onto "settle N intents at one
  price then net the deltas," which is the batch-auction settlement shape.

## What was confusing / friction

- **`beforeSwap` is inherently per-swap, but a batch auction is inherently multi-swap.** The hook
  interface fires once per swap call; expressing "accumulate many intents over a window, then clear
  them together at one price" requires the hook to buffer state across calls and pick a settlement
  trigger. There's no first-class notion of a *batch* or a *block-window settlement callback*, so the
  batching/clearing lifecycle has to be hand-rolled in hook storage. Documented patterns for
  window-based/batched settlement (vs. per-swap) were the hardest thing to find.
- **Testing hooks requires the full v4 deploy surface** (PoolManager, hook-address mining for the
  permission bits, routers). For a continuity project whose core is a standalone settlement contract,
  standing up the entire v4 test harness just to exercise one primitive is heavy — which is why we
  keep the primitive as a plain library and reference the hook interface, rather than shipping a full
  deployed hook in this timeframe.

## One concrete improvement suggestion

Add a **first-class "batch settlement" pattern (and example) to v4 periphery**: a `BaseBatchHook`
(or a documented recipe) that buffers intents in `beforeSwap`, exposes a permissionless
`settleBatch()` that clears all buffered flow at a single hook-computed price and emits the netted
deltas, and a canonical hook-address-mining + test scaffold for it. Uniform-price batch auctions
(CoW-style, and this project) are a recurring MEV-mitigation design; a supported periphery primitive
for "accumulate → clear at one price → net deltas" would save every such team from re-deriving the
cross-call buffering + settlement-trigger plumbing. `contracts/lib/BatchAuction.sol` in this repo is a
minimal, tested core such a primitive could build on.

---

*Submitted alongside the Uniswap Developer Feedback Form. Reusable hook core:*
`aegis/packages/hardhat/contracts/lib/BatchAuction.sol`.
