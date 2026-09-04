import { BigInt } from "@graphprotocol/graph-ts";
import {
  BatchCreated, Deposited, OraclePriceCollected,
  OracleWeightUpdated, BatchSettled, BatchVoided, Claimed,
} from "../generated/AegisV3/AegisV3";
import { Batch, Order, OracleObservation, OracleWeight, Settlement } from "../generated/schema";

export function handleBatchCreated(e: BatchCreated): void {
  let b = new Batch(e.params.batchId.toString());
  b.state = 0;
  b.asset = e.params.asset;
  b.buyVolume = BigInt.zero();
  b.sellVolume = BigInt.zero();
  b.settlementPrice = BigInt.zero();
  b.settled = false;
  b.createdAt = e.block.timestamp;
  b.save();
}

export function handleDeposited(e: Deposited): void {
  let id = e.params.batchId.toString() + "-" + e.params.user.toHexString();
  let o = Order.load(id);
  if (o == null) {
    o = new Order(id);
    o.batch = e.params.batchId.toString();
    o.user = e.params.user;
    o.amount = BigInt.zero();
    o.claimed = false;
  }
  o.amount = o.amount.plus(e.params.amount);
  o.side = e.params.side;
  o.save();

  let b = Batch.load(e.params.batchId.toString());
  if (b != null) {
    if (e.params.side == 0) b.buyVolume = b.buyVolume.plus(e.params.amount);
    else b.sellVolume = b.sellVolume.plus(e.params.amount);
    b.save();
  }
}

export function handleOraclePriceCollected(e: OraclePriceCollected): void {
  let id = e.params.batchId.toString() + "-" + e.params.oracleId.toString() + "-" + e.logIndex.toString();
  let obs = new OracleObservation(id);
  obs.batch = e.params.batchId.toString();
  obs.oracleId = e.params.oracleId;
  obs.price = e.params.price;
  obs.isValid = e.params.isValid;
  obs.blockNumber = e.block.number;
  obs.save();
}

export function handleOracleWeightUpdated(e: OracleWeightUpdated): void {
  let w = OracleWeight.load(e.params.oracleId.toString());
  if (w == null) w = new OracleWeight(e.params.oracleId.toString());
  w.oracleId = e.params.oracleId;
  w.weight = e.params.newWeight;
  w.lastDelta1 = e.params.delta1;
  w.lastDelta2 = e.params.delta2;
  w.updatedAt = e.block.timestamp;
  w.save();
}

export function handleBatchSettled(e: BatchSettled): void {
  let s = new Settlement(e.params.batchId.toString());
  s.batch = e.params.batchId.toString();
  s.settlementPrice = e.params.settlementPrice;
  s.buyFillRatio = e.params.buyFillRatio;
  s.sellFillRatio = e.params.sellFillRatio;
  s.timestamp = e.block.timestamp;
  s.save();

  let b = Batch.load(e.params.batchId.toString());
  if (b != null) { b.settled = true; b.settlementPrice = e.params.settlementPrice; b.state = 3; b.save(); }
}

export function handleBatchVoided(e: BatchVoided): void {
  let b = Batch.load(e.params.batchId.toString());
  if (b != null) { b.voidedReason = e.params.reason; b.save(); }
}

export function handleClaimed(e: Claimed): void {
  let id = e.params.batchId.toString() + "-" + e.params.user.toHexString();
  let o = Order.load(id);
  if (o != null) { o.claimed = true; o.save(); }
}
