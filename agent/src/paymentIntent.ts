// AgentPaymentIntent — the agent-facing framing of an Aegis order.
//
// An autonomous agent that needs to move value onchain (pay/convert one asset
// into another) expresses that as a *payment intent*: "spend this much of this
// asset." Aegis maps the intent to a batch order so the agent settles at a fair
// uniform clearing price — no front-run, no sandwich, no single manipulable
// oracle — instead of firing a raw, MEV-exposed swap into the mempool.
//
// This is a thin, honest adapter: it changes vocabulary, not economics. The
// two-asset batch is BASE (WETH, 18-dec) vs QUOTE (USDC, 6-dec); in AegisV4 a
// BUY deposits QUOTE to acquire BASE and a SELL deposits BASE for QUOTE. So
// "what the agent pays with" is exactly what determines the order side.

export type Asset = "BASE" | "QUOTE";
export type Side = "BUY" | "SELL";

export interface AgentPaymentIntent {
  // The asset the agent is spending, in that asset's smallest unit.
  payWith: Asset;
  amount: bigint;
}

export interface AegisOrder {
  amount: bigint;
  side: Side;
}

export function intentToOrder(intent: AgentPaymentIntent): AegisOrder {
  if (intent.amount <= 0n) {
    throw new Error("payment amount must be positive");
  }
  // Spending QUOTE (USDC) to receive BASE == BUY; spending BASE to receive QUOTE == SELL.
  return {
    amount: intent.amount,
    side: intent.payWith === "QUOTE" ? "BUY" : "SELL",
  };
}
