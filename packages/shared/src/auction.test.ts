import assert from "node:assert/strict";
import { test } from "node:test";
import { settleAuction } from "./auction.js";
import { spotPrice, tokensOutForEth } from "./amm.js";
import type { AuctionIntent, PoolState } from "./types.js";

const pool: PoolState = { ethReserve: 100, tokenReserve: 1_000_000, totalSupply: 2_000_000 };

function intent(id: string, ethAmount: number, maxPrice?: number): AuctionIntent {
  return { id, roundId: "r1", userAddress: `0x${id}`, ethAmount, maxPrice, submittedAt: 0 };
}

test("all market orders under cap: everyone fully filled at one price", () => {
  const res = settleAuction({
    roundId: "r1",
    intents: [intent("a", 5), intent("b", 10), intent("c", 1)],
    pool,
    maxRaise: 50,
    feeBps: 0,
  });
  assert.ok(Math.abs(res.totalRaised - 16) < 1e-6);
  assert.equal(res.fillRatio, 1);
  for (const f of res.fills) {
    assert.ok(Math.abs(f.ethFilled - f.ethIn) < 1e-9);
    assert.ok(Math.abs(f.tokensOut * res.clearingPrice - f.ethFilled) < 1e-6, "uniform price");
  }
  assert.ok(res.clearingPrice > spotPrice(pool));
});

test("oversubscription fills pro-rata, not by order or price", () => {
  const res = settleAuction({
    roundId: "r1",
    intents: [intent("late", 30), intent("early", 10)],
    pool,
    maxRaise: 20,
    feeBps: 0,
  });
  assert.ok(Math.abs(res.totalRaised - 20) < 1e-6);
  assert.ok(Math.abs(res.fillRatio - 0.5) < 1e-6);
  const late = res.fills.find((f) => f.intentId === "late")!;
  const early = res.fills.find((f) => f.intentId === "early")!;
  assert.ok(Math.abs(late.ethFilled - 15) < 1e-6);
  assert.ok(Math.abs(early.ethFilled - 5) < 1e-6);
  assert.ok(Math.abs(late.refund - 15) < 1e-6);
  // identical per-ETH token rate for both
  assert.ok(
    Math.abs(late.tokensOut / late.ethFilled - early.tokensOut / early.ethFilled) < 1e-9,
  );
});

test("limit below clearing price is excluded and fully refunded", () => {
  const spot = spotPrice(pool); // 0.0001
  const res = settleAuction({
    roundId: "r1",
    intents: [intent("mkt", 40), intent("tight", 10, spot * 1.000001)],
    pool,
    maxRaise: 100,
    feeBps: 0,
  });
  const tight = res.fills.find((f) => f.intentId === "tight")!;
  assert.equal(tight.ethFilled, 0);
  assert.equal(tight.tokensOut, 0);
  assert.equal(tight.refund, 10);
  assert.ok(res.clearingPrice > spot * 1.000001);
  // market order still fills fully
  const mkt = res.fills.find((f) => f.intentId === "mkt")!;
  assert.ok(Math.abs(mkt.ethFilled - 40) < 1e-4);
});

test("limit prices cap the raise at the marginal price", () => {
  // Everyone limits at a price reachable with a small raise; clearing must respect it.
  const limit = spotPrice(pool) * 1.05;
  const res = settleAuction({
    roundId: "r1",
    intents: [intent("a", 100, limit), intent("b", 100, limit)],
    pool,
    maxRaise: 1000,
    feeBps: 0,
  });
  assert.ok(res.clearingPrice <= limit * 1.0001);
  assert.ok(res.totalRaised < 200);
  assert.ok(res.fillRatio < 1);
});

test("settlement is deterministic and order-independent (audit hash)", () => {
  const a = settleAuction({
    roundId: "r1",
    intents: [intent("a", 5), intent("b", 10)],
    pool,
    maxRaise: 50,
    feeBps: 50,
    now: 123,
  });
  const b = settleAuction({
    roundId: "r1",
    intents: [intent("b", 10), intent("a", 5)],
    pool,
    maxRaise: 50,
    feeBps: 50,
    now: 456,
  });
  assert.equal(a.auditHash, b.auditHash);
  assert.equal(a.clearingPrice, b.clearingPrice);
});

test("pool conservation: tokens out match reserve change, fee withheld from pool", () => {
  const res = settleAuction({
    roundId: "r1",
    intents: [intent("a", 20)],
    pool,
    maxRaise: 50,
    feeBps: 100, // 1%
  });
  const tokensOut = res.fills[0]!.tokensOut;
  assert.ok(Math.abs(pool.tokenReserve - res.poolAfter.tokenReserve - tokensOut) < 1e-6);
  const ethToPool = res.poolAfter.ethReserve - pool.ethReserve;
  assert.ok(Math.abs(ethToPool - 20 * 0.99) < 1e-9);
  assert.ok(Math.abs(tokensOut - tokensOutForEth(pool, 19.8)) < 1e-9);
});

test("empty queue settles to zero raise at spot", () => {
  const res = settleAuction({ roundId: "r1", intents: [], pool, maxRaise: 50, feeBps: 0 });
  assert.equal(res.totalRaised, 0);
  assert.equal(res.fills.length, 0);
  assert.equal(res.poolAfter.ethReserve, pool.ethReserve);
});
