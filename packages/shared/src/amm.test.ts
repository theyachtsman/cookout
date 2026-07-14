import assert from "node:assert/strict";
import { test } from "node:test";
import { buy, sell, spotPrice, marketCap } from "./amm.js";
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
