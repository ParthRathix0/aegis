# Aegis Subgraph

The Graph subgraph that indexes all AegisV4 batch, oracle, and settlement events. This is the
Solver Agent's primary data source — the agent queries it every tick to read the current batch
phase and oracle-reliability history before deciding which crank action to execute.

## Live endpoint

```
https://api.studio.thegraph.com/query/1758636/aegis-solver/v0.1.0
```

## What it indexes

| Entity | Events |
|---|---|
| `Batch` | `BatchCreated`, `BatchSettled`, `BatchVoided` |
| `Order` | `Deposited`, `Claimed` |
| `OracleObservation` | `OraclePriceCollected` |
| `OracleWeight` | `OracleWeightUpdated` |
| `Settlement` | `BatchSettled` (aggregated fill data) |

## Queries used by the agent

```graphql
# Current batch phase (agent's primary read each tick)
query BatchPhase($batchId: String!) {
  batch(id: $batchId) {
    state
    endBlock
  }
}

# Oracle reliability history (agent refuses to deposit if < 2 reliable oracles)
query OracleHealth {
  oracleObservations(first: 100, orderBy: blockNumber, orderDirection: desc) {
    oracle
    valid
    blockNumber
  }
}
```

Full query set: [`QUERIES.md`](./QUERIES.md)

## Deploy

```bash
yarn install
yarn codegen      # generate AssemblyScript types
yarn build        # compile mappings

# authenticate with Studio deploy key
graph auth <THEGRAPH_DEPLOY_KEY>
yarn deploy       # deploys aegis-solver to Studio
```

The `subgraph.yaml` source address is set to the canonical AegisV4 on Sepolia
(`0x0a16364229EeFDA44332cB6D194E20937C51CE5b`, startBlock `11654395`).

## Layout

```
schema.graphql     entity definitions
subgraph.yaml      data sources + event handlers
src/aegis.ts       AssemblyScript mapping handlers
abis/AegisV4.json  contract ABI for event decoding
QUERIES.md         all queries the agent uses
```
