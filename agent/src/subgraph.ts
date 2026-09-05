import { request, gql } from "graphql-request";
import { BatchState, Phase } from "./decide";

// The Graph is the agent's data source (The Graph — AI Tooling Continuity).
// Each tick the agent reads the current batch's phase (+ volumes for context)
// from the subgraph rather than raw logs. `Batch.state` is stored as an Int
// (0..3) by the mapping, matching the AegisV4 BatchState enum ordering.
const BATCH_Q = gql`
  query CurrentBatch($id: ID!) {
    batch(id: $id) {
      id
      state
      buyVolume
      sellVolume
      settlementPrice
      settled
    }
  }
`;

const PHASES: Phase[] = ["OPEN", "ACCUMULATING", "DISPUTING", "SETTLING"];

export function phaseFromState(state: number): Phase {
  return PHASES[state] ?? "OPEN";
}

// Reads the batch phase from the subgraph. endBlock / lastCollectBlock are NOT
// in the subgraph schema — the loop reads those from the contract's
// getCurrentBatchInfo() / lastCollectionBlock() views (see loop.ts). The
// subgraph is the source of the phase (and volumes for the dashboard/context).
export async function fetchBatchPhase(url: string, batchId: string): Promise<Phase> {
  const d: any = await request(url, BATCH_Q, { id: batchId });
  return phaseFromState(Number(d.batch?.state ?? 0));
}
