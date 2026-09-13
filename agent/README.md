# Aegis Solver Agent

Autonomous solver that drives the AegisV4 batch lifecycle end-to-end. The four phase-transition
functions on AegisV4 are permissionless and only advance when someone calls them — this agent is
that someone. Remove it and no batch ever settles.

Each tick the agent:

1. reads the current batch phase from **The Graph subgraph** (`SUBGRAPH_URL`), falling back to the
   contract's `getCurrentBatchInfo()` state when no subgraph is configured (local dev),
2. reads `endBlock` / `lastCollectionBlock` from the contract,
3. decides the next legal crank action via the pure `decideAction()` core, and
4. executes it onchain — via a Circle Agent Stack wallet in production, or a raw key for local smoke tests.

## Layout

| File | Role |
|---|---|
| `src/decide.ts` | Pure `decideAction(state, block) → CrankAction`. No I/O; fully unit-tested. |
| `src/subgraph.ts` | `fetchBatchPhase(url, batchId)` — reads phase from The Graph. |
| `src/analytics.ts` | `fetchOracleHealth()` — reads oracle reliability history; agent refuses to deposit if fewer than 2 oracles have been reliably valid. |
| `src/executor.ts` | `executeCrank(contract, action)` — maps a decided action to a signed tx. |
| `src/circle.ts` | Circle Agent Stack wallet integration — routes crank writes through a developer-controlled wallet for native USDC settlement on Arc. |
| `src/payment.ts` | `submitPaymentIntent()` — agent deposits a BUY/SELL payment intent each fresh OPEN batch (demo seed). |
| `src/aqua.ts` | `routeUncrossedIfConfigured()` — post-settlement hook that routes uncrossed remainder to 1inch SwapVM via AquaRouter. |
| `src/loop.ts` | The tick loop wiring everything together. |
| `test/*.test.ts` | Vitest unit tests (42 tests green). |

## Run against Sepolia (production)

```bash
yarn install
cp .env.example .env    # fill in values — see .env.example comments
yarn test               # unit tests (decide + executor + circle)
yarn start              # runs the autonomous tick loop
```

Sepolia values (already in the repo's .env for reference):

```
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>
AEGIS_ADDRESS=0x0a16364229EeFDA44332cB6D194E20937C51CE5b
SUBGRAPH_URL=https://api.studio.thegraph.com/query/1758636/aegis-solver/v0.1.0
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
BASE_ASSET=0xDd27A82485fd77f4eEF95d0876918B723893B36D
QUOTE_ASSET=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
```

## Run locally (smoke test — no subgraph needed)

```bash
# Terminal A — local chain + deploy
cd ../packages/hardhat
yarn hardhat node --network hardhat --no-deploy
yarn hardhat deploy --network localhost --tags AegisV4    # note the AegisV4 address

# advance blocks so phase windows elapse:
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"evm_setIntervalMining","params":[200],"id":1}'

# Terminal B — run the agent (contract fallback, no subgraph)
cd ../../agent
RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
AEGIS_ADDRESS=<deployed AegisV4> \
SUBGRAPH_URL= \
TICK_MS=800 yarn start
```

Observed output — the agent autonomously advances a full batch and rolls into the next one with no
human calling any function:

```
batch=0 OPEN           startAccumulation    0xd0f3...
batch=0 ACCUMULATING   collectOraclePrices  0x8538...   (repeats every COLLECTION_INTERVAL blocks)
batch=0 ACCUMULATING   startDispute         0x07f0...
batch=0 DISPUTING      wait
batch=0 DISPUTING      startSettling        0x38f3...
batch=0 SETTLING       wait
batch=0 SETTLING       executeSettlement    0x257c...
batch=1 OPEN           wait
batch=1 OPEN           startAccumulation    0xd0f3...
...
```

## Production — Arc / native USDC

The raw `ethers.Wallet` signer is replaced by a Circle developer-controlled wallet (see `CIRCLE_*`
in `.env.example`) so settlement moves native USDC on Arc. All crank writes route through
`executeCrankViaCircle()` in `src/circle.ts`.

Proven: 5 USDC settled agent to counterparty on Arc testnet (chain 5042002).
Full tx set: `settlement-evidence.arc.json`.
