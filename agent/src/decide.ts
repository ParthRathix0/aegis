// Pure decision core for the Aegis Solver Agent.
//
// Given the current batch state and the current block number, it returns the
// single next legal crank action. It performs NO network calls — state in,
// action out — so it is fully unit-testable. The onchain executor and tick
// loop stay thin because all the lifecycle logic lives here.
//
// The rules mirror the permissionless guards in AegisV4:
//   OPEN         & block >= endBlock                    -> startAccumulation
//   ACCUMULATING & block >= endBlock                    -> startDispute
//   ACCUMULATING & block >= lastCollect + INTERVAL      -> collectOraclePrices
//   DISPUTING    & block >= endBlock                    -> startSettling
//   SETTLING     & block >= endBlock                    -> executeSettlement
//   otherwise                                           -> wait

export type Phase = "OPEN" | "ACCUMULATING" | "DISPUTING" | "SETTLING";

export interface BatchState {
  batchId: string;
  phase: Phase;
  endBlock: number;
  lastCollectBlock: number;
}

export type CrankAction =
  | { kind: "startAccumulation" }
  | { kind: "collectOraclePrices" }
  | { kind: "startDispute" }
  | { kind: "startSettling" }
  | { kind: "executeSettlement" }
  | { kind: "wait" };

// Must match AegisV4's COLLECTION_INTERVAL guard (blocks between oracle collects).
const COLLECTION_INTERVAL = 4;

export function decideAction(s: BatchState, currentBlock: number): CrankAction {
  switch (s.phase) {
    case "OPEN":
      return currentBlock >= s.endBlock
        ? { kind: "startAccumulation" }
        : { kind: "wait" };
    case "ACCUMULATING":
      if (currentBlock >= s.endBlock) return { kind: "startDispute" };
      if (currentBlock >= s.lastCollectBlock + COLLECTION_INTERVAL)
        return { kind: "collectOraclePrices" };
      return { kind: "wait" };
    case "DISPUTING":
      return currentBlock >= s.endBlock
        ? { kind: "startSettling" }
        : { kind: "wait" };
    case "SETTLING":
      return currentBlock >= s.endBlock
        ? { kind: "executeSettlement" }
        : { kind: "wait" };
    default:
      return { kind: "wait" };
  }
}
