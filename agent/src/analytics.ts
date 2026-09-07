import { request, gql } from "graphql-request";

// Oracle-health analytics derived from The Graph (load-bearing use of the subgraph).
//
// A single contract call only tells the agent an oracle's CURRENT reading. To
// know whether a settlement will actually succeed, the agent needs the *history*
// of which oracles have been producing valid observations across recent batches —
// exactly what the subgraph indexes (OracleObservation.isValid). The agent uses
// this to avoid depositing/settling into a batch that would void with
// "Insufficient valid oracles" (< 2 valid). This reasoning is impossible without
// The Graph.

export interface ObservationLite {
  oracleId: string;
  isValid: boolean;
}

export interface OracleReliability {
  oracleId: string;
  total: number;
  valid: number;
  rate: number; // valid / total, in [0,1]
}

// Aggregate raw observations into a per-oracle reliability rate.
export function computeReliability(obs: ObservationLite[]): OracleReliability[] {
  const m = new Map<string, { total: number; valid: number }>();
  for (const o of obs) {
    const e = m.get(o.oracleId) ?? { total: 0, valid: 0 };
    e.total++;
    if (o.isValid) e.valid++;
    m.set(o.oracleId, e);
  }
  return [...m.entries()].map(([oracleId, { total, valid }]) => ({
    oracleId,
    total,
    valid,
    rate: total ? valid / total : 0,
  }));
}

// How many oracles clear the reliability bar.
export function reliableOracleCount(report: OracleReliability[], minRate = 0.5): number {
  return report.filter((r) => r.rate >= minRate).length;
}

// AegisV4 voids a batch when fewer than 2 oracles produce valid observations.
// Settlement is "safe" only when at least `minReliable` oracles have been
// reliably valid in recent history.
export function isSettlementSafe(report: OracleReliability[], minReliable = 2, minRate = 0.5): boolean {
  return reliableOracleCount(report, minRate) >= minReliable;
}

const RECENT_OBS_Q = gql`
  query RecentObservations($first: Int!) {
    oracleObservations(first: $first, orderBy: blockNumber, orderDirection: desc) {
      oracleId
      isValid
    }
  }
`;

// Query the subgraph for the most recent oracle observations and reduce them to
// a reliability report. `first` bounds how much history informs the decision.
export async function fetchOracleHealth(url: string, first = 60): Promise<OracleReliability[]> {
  const d: any = await request(url, RECENT_OBS_Q, { first });
  const obs: ObservationLite[] = (d.oracleObservations ?? []).map((o: any) => ({
    oracleId: String(o.oracleId),
    isValid: Boolean(o.isValid),
  }));
  return computeReliability(obs);
}
