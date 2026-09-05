# Aegis Solver Agent

Autonomous solver that drives the **AegisV4** batch lifecycle end-to-end. The
four phase-transition functions on AegisV4 are permissionless and only advance
when someone calls them — this agent is that someone. Remove it and no batch
ever settles.

Each tick the agent:

1. reads the current batch's phase from **The Graph subgraph** (`SUBGRAPH_URL`),
   falling back to the contract's `getCurrentBatchInfo()` state when no subgraph
   is configured (local dev),
2. reads `endBlock` / `lastCollectionBlock` from the contract,
3. decides the next legal crank action via the pure `decideAction()` core, and
4. executes it onchain (via a Circle Agent Stack wallet in production; a raw key
   for local smoke tests).

## Layout

| File | Role |
|---|---|
| `src/decide.ts` | Pure `decideAction(state, block) → CrankAction`. No I/O; fully unit-tested. |
| `src/subgraph.ts` | `fetchBatchPhase(url, batchId)` — reads phase from the subgraph. |
| `src/executor.ts` | `executeCrank(contract, action)` — maps an action to a signed tx. |
| `src/loop.ts` | The tick loop wiring the three together. |
| `test/*.test.ts` | Vitest unit tests for the decision core and executor. |

## Run

```bash
yarn install
cp .env.example .env   # fill in RPC_URL, AEGIS_ADDRESS, SUBGRAPH_URL, signer/Circle
yarn test              # unit tests (decide + executor)
yarn start             # run the autonomous tick loop
```

## Local smoke test (proves the agent is load-bearing)

```bash
# terminal A — local chain + deploy AegisV4
cd ../packages/hardhat
yarn hardhat node --network hardhat --no-deploy        # start local chain
yarn hardhat deploy --network localhost --tags AegisV4 # note the AegisV4 address
# advance blocks so phase windows elapse:
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"evm_setIntervalMining","params":[200],"id":1}'

# terminal B — run the agent against the local chain (no subgraph → contract fallback)
cd ../../agent
RPC_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
AEGIS_ADDRESS=<deployed AegisV4> SUBGRAPH_URL= TICK_MS=800 yarn start
```

Observed output — the agent autonomously advances a full batch and rolls into
the next one, with **no human calling any function**:

```
batch=0 ACCUMULATING  startDispute        0x07f0…
batch=0 DISPUTING      wait
batch=0 DISPUTING      startSettling       0x38f3…
batch=0 SETTLING       wait
batch=0 SETTLING       executeSettlement   0x257c…
batch=1 OPEN           wait                 (window not elapsed)
batch=1 OPEN           startAccumulation   0xd0f3…
batch=1 ACCUMULATING   collectOraclePrices 0x8538…   (repeats every COLLECTION_INTERVAL)
batch=1 ACCUMULATING   startDispute        0x502b…
batch=1 DISPUTING      wait
…
```

## Production (Arc / native USDC)

In production the raw `ethers.Wallet` signer is replaced by a **Circle Agent
Stack** wallet (see `CIRCLE_*` in `.env.example`) so settlement moves native
USDC on Arc. Provision the wallet via the current Circle Wallets quickstart and
record the settled-in-USDC tx hash for the Arc submission.
