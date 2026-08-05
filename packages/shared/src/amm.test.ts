import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SLIPPAGE_BPS,
  buy,
  marketCap,
  minOutWei,
  quoteBuyWei,
  quoteSellWei,
  sell,
  spotPrice,
} from "./amm.js";
import type { PoolState } from "./types.js";

const pool: PoolState = { ethReserve: 100, tokenReserve: 1_000_000, totalSupply: 2_000_000 };

test("spot price and market cap", () => {
  assert.equal(spotPrice(pool), 0.0001);
  assert.equal(marketCap(pool), 200);
});

test("buy raises price, sell lowers it, k preserved (net of fee)", () => {
  const b = buy(pool, 10, 0);
  assert.ok(spotPrice(b.pool) > spotPrice(pool));
  assert.ok(Math.abs(b.pool.ethReserve * b.pool.tokenReserve - 100 * 1_000_000) < 1e-3);
  const s = sell(b.pool, b.amountOut, 0);
  assert.ok(Math.abs(s.amountOut - 10) < 1e-9, "round trip with no fee returns input");
});

test("fees reduce output", () => {
  const noFee = buy(pool, 10, 0);
  const withFee = buy(pool, 10, 100);
  assert.ok(withFee.amountOut < noFee.amountOut);
  assert.ok(Math.abs(withFee.fee - 0.1) < 1e-9);
});

test("levels are monotonic", async () => {
  const { levelForXp, xpForLevel, titleForLevel } = await import("./gamification.js");
  assert.equal(levelForXp(0), 1);
  assert.equal(titleForLevel(1), "Rookie");
  assert.equal(titleForLevel(100), "Robinhood King");
  let prev = 0;
  for (let l = 2; l <= 100; l++) {
    const req = xpForLevel(l);
    assert.ok(req > prev);
    prev = req;
  }
  assert.equal(levelForXp(xpForLevel(35)), 35);
});

// --- exact wei quotes (the on-chain slippage floor depends on these) ---

test("quoteBuyWei mirrors the contract's fee-then-curve order", () => {
  const r = { ethReserve: 100n * 10n ** 18n, tokenReserve: 1_000_000n * 10n ** 18n };
  const value = 10n ** 18n; // 1 ETH
  const fee = (value * 100n) / 10_000n;
  const net = value - fee;
  const k = r.ethReserve * r.tokenReserve;
  assert.equal(quoteBuyWei(r, value, 100), r.tokenReserve - k / (r.ethReserve + net));
  // Fee first, then the curve — charging it the other way round pays out more
  // than the pool will, which is exactly the error that reverts real trades.
  assert.ok(quoteBuyWei(r, value, 100) < quoteBuyWei(r, value, 0));
});

test("quoteSellWei takes its fee off the ETH out", () => {
  const r = { ethReserve: 100n * 10n ** 18n, tokenReserve: 1_000_000n * 10n ** 18n };
  const tokens = 1_000n * 10n ** 18n;
  const k = r.ethReserve * r.tokenReserve;
  const gross = r.ethReserve - k / (r.tokenReserve + tokens);
  assert.equal(quoteSellWei(r, tokens, 100), gross - (gross * 100n) / 10_000n);
});

test("a round trip loses money — the curve is never free", () => {
  const r = { ethReserve: 100n * 10n ** 18n, tokenReserve: 1_000_000n * 10n ** 18n };
  const value = 5n * 10n ** 18n;
  const tokens = quoteBuyWei(r, value, 100);
  const after = {
    ethReserve: r.ethReserve + (value - (value * 100n) / 10_000n),
    tokenReserve: r.tokenReserve - tokens,
  };
  assert.ok(quoteSellWei(after, tokens, 100) < value, "buy then sell must not profit");
});

test("degenerate inputs quote zero rather than throwing or going negative", () => {
  const r = { ethReserve: 100n * 10n ** 18n, tokenReserve: 1_000_000n * 10n ** 18n };
  assert.equal(quoteBuyWei(r, 0n, 100), 0n);
  assert.equal(quoteSellWei(r, 0n, 100), 0n);
  assert.equal(quoteBuyWei({ ethReserve: 0n, tokenReserve: 0n }, 10n ** 18n, 100), 0n);
});

test("minOutWei clamps the tolerance instead of trusting it", () => {
  assert.equal(minOutWei(1_000n, 100), 990n);
  assert.equal(minOutWei(1_000n, 0), 1_000n);
  // A negative or absurd tolerance must not widen the floor past nothing —
  // a caller bug should not silently disable slippage protection.
  assert.equal(minOutWei(1_000n, -50), 1_000n);
  assert.equal(minOutWei(1_000n, 9_999), minOutWei(1_000n, MAX_SLIPPAGE_BPS));
});
