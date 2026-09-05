import { ethers } from "ethers";
import { CrankAction } from "./decide";

// Thin onchain executor: maps a decided CrankAction to the matching
// permissionless AegisV4 phase-transition call and returns the tx hash
// (or null for `wait`). All lifecycle logic lives in decideAction — this
// file only translates an action into a signed transaction.
export async function executeCrank(
  c: ethers.Contract,
  a: CrankAction,
): Promise<string | null> {
  switch (a.kind) {
    case "wait":
      return null;
    case "startAccumulation":
      return (await (await c.startAccumulation()).wait())?.hash ?? null;
    case "collectOraclePrices":
      return (await (await c.collectOraclePrices()).wait())?.hash ?? null;
    case "startDispute":
      return (await (await c.startDispute()).wait())?.hash ?? null;
    case "startSettling":
      return (await (await c.startSettling()).wait())?.hash ?? null;
    case "executeSettlement":
      return (await (await c.executeSettlement()).wait())?.hash ?? null;
  }
}
