# Aegis Subgraph — Agent-Facing Queries

Subgraph: `aegis-solver` (Subgraph Studio, Sepolia). Indexes AegisV3
`0xA514727e7EC43F6a99ceB11F25df36c922e040Ad` from block 11633919.

## Load-bearing query (Solver Agent, Plan 5)

The Solver Agent calls this each tick to decide the next crank action:

```graphql
query CurrentBatch($id: ID!) {
  batch(id: $id) {
    id
    state
    buyVolume
    sellVolume
    settlementPrice
    settled
    voidedReason
    observations {
      oracleId
      price
      isValid
    }
  }
  oracleWeights {
    oracleId
    weight
  }
}
```

Plan 5's agent queries this instead of reading raw logs; **without the subgraph the
agent has no state to act on** — this is what makes the subgraph load-bearing for
The Graph — AI Tooling Continuity.

## Entities

- `Batch` — per-batch state, buy/sell volume, settlement price, settled/voided flags.
- `Order` — per-user deposit in a batch (amount, side, claimed).
- `OracleObservation` — each oracle price collected per batch (price, isValid).
- `OracleWeight` — current confidence weight per oracle (updated on every re-weight).
- `Settlement` — final settlement record per batch (price, fill ratios).

## Deploy

```bash
cd subgraph
yarn graph auth <STUDIO_DEPLOY_KEY>   # from Subgraph Studio -> aegis-solver
yarn deploy                            # graph deploy aegis-solver
```
