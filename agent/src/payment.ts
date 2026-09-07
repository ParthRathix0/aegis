import { ethers } from "ethers";
import { AgentPaymentIntent, intentToOrder, Side } from "./paymentIntent";

// AegisV4 Side enum on the wire: BUY = 0, SELL = 1.
const SIDE_CODE: Record<Side, number> = { BUY: 0, SELL: 1 };

// Submit an agent payment intent to Aegis as a batch deposit. The intent
// ("spend this much of this asset") is mapped to an Aegis order and deposited
// via deposit(uint256 amount, Side side), so the agent's payment settles at the
// fair batch clearing price instead of a raw, MEV-exposed swap.
//
// The write contract must expose deposit(uint256,uint8); ERC20 allowance for
// the spent asset is the caller's responsibility (approve once before running).
export async function submitPaymentIntent(
  c: ethers.Contract,
  intent: AgentPaymentIntent,
): Promise<string | null> {
  const order = intentToOrder(intent);
  const tx = await c.deposit(order.amount, SIDE_CODE[order.side]);
  return (await tx.wait())?.hash ?? null;
}
