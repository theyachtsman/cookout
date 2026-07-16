import assert from "node:assert/strict";
import { test } from "node:test";
import { JACKPOT_FEE_SHARE, JACKPOT_PAYOUT_WEIGHTS, weekKey } from "@cookout/shared";
import { accrueJackpot, jackpotStatus, settleWeeklyJackpot } from "./jackpot.js";
import { Store } from "./store.js";

/** A week key guaranteed different from `weekKey(now)`, two weeks earlier. */
const priorWeek = (now: number) => weekKey(now - 14 * 86_400_000);

function seedWeeklyXp(store: Store, week: string, xpByAddr: Record<string, number>) {
  for (const [addr, xp] of Object.entries(xpByAddr)) {
    const u = store.getOrCreateUser(addr);
    u.weeklyXp[week] = xp;
  }
}

test("accrual takes exactly JACKPOT_FEE_SHARE of fees", () => {
  const store = new Store();
  assert.equal(accrueJackpot(store, 10), 10 * JACKPOT_FEE_SHARE);
  assert.equal(accrueJackpot(store, 0), 0);
  assert.equal(store.jackpotPool, 3); // 10 * 0.3
});

test("settlement pays top-10 by weekly XP, ranks 1>2>3, and is one-shot per week", () => {
  const now = Date.UTC(2026, 6, 15, 12);
  const store = new Store();
  const week = priorWeek(now);
  store.jackpotWeekKey = week;
  store.jackpotPool = 100;
  store.ethUsd = 2000;

  // 12 earners; ranking is strictly by weekly XP.
  const xp: Record<string, number> = {};
  for (let i = 0; i < 12; i++) xp[`0x${String(i).padStart(40, "0")}`] = (12 - i) * 100;
  seedWeeklyXp(store, week, xp);

  const payout = settleWeeklyJackpot(store, now);
  assert.ok(payout, "a payout happened");
  assert.equal(payout.winners.length, 10, "exactly 10 winners");
  assert.equal(payout.week, week);

  // Weights applied in rank order; 1 > 2 > 3.
  const first = store.getOrCreateUser("0x" + "0".repeat(40));
  assert.equal(first.jackpotWinnings, 100 * JACKPOT_PAYOUT_WEIGHTS[0]);
  assert.ok(payout.winners[0]!.amountEth > payout.winners[1]!.amountEth);
  assert.ok(payout.winners[1]!.amountEth > payout.winners[2]!.amountEth);

  // Winners credited to paper balance + profile record.
  assert.equal(first.paperBalance > 10, true);
  assert.equal(first.jackpotWins.at(-1)?.rank, 1);
  assert.equal(first.jackpotWins.at(-1)?.week, week);

  // Full pot distributed (10+ players ⇒ weights sum to 1), week advanced.
  assert.ok(Math.abs(payout.totalEth - 100) < 1e-9, "whole pot paid");
  assert.ok(Math.abs(store.jackpotPool) < 1e-9, "pool emptied");
  assert.equal(store.jackpotWeekKey, weekKey(now));
  assert.equal(store.jackpotLifetimeEth, payout.totalEth);

  // Same week again → no double payout.
  assert.equal(settleWeeklyJackpot(store, now), null);
});

test("fewer than 10 winners: unfilled shares roll into the new week", () => {
  const now = Date.UTC(2026, 6, 15, 12);
  const store = new Store();
  const week = priorWeek(now);
  store.jackpotWeekKey = week;
  store.jackpotPool = 100;
  seedWeeklyXp(store, week, { "0xaa": 500, "0xbb": 300, "0xcc": 100 });

  const payout = settleWeeklyJackpot(store, now)!;
  const paid = (JACKPOT_PAYOUT_WEIGHTS[0] + JACKPOT_PAYOUT_WEIGHTS[1] + JACKPOT_PAYOUT_WEIGHTS[2]) * 100;
  assert.ok(Math.abs(payout.totalEth - paid) < 1e-9, "only the top-3 shares paid");
  // Remainder rolled forward, not lost.
  assert.ok(Math.abs(store.jackpotPool - (100 - paid)) < 1e-9, "remainder rolls over");
});

test("status reports the fee breakdown and projected standings", () => {
  const store = new Store();
  store.jackpotPool = 50;
  store.ethUsd = 2000;
  seedWeeklyXp(store, store.jackpotWeekKey, { "0xaa": 200, "0xbb": 50 });

  const s = jackpotStatus(store);
  assert.equal(s.breakdown.jackpotPct, 30);
  assert.equal(s.breakdown.creatorPct + s.breakdown.referralPct + s.breakdown.jackpotPct + s.breakdown.housePct, 100);
  assert.equal(s.poolUsd, 50 * 2000);
  assert.equal(s.standings[0]!.address, "0xaa");
  assert.equal(s.standings[0]!.rank, 1);
  assert.equal(s.standings[0]!.amountEth, 50 * JACKPOT_PAYOUT_WEIGHTS[0]);
});

test("addXp feeds the current week's jackpot ranking", () => {
  const store = new Store();
  store.addXp("0xabc", 42);
  assert.equal(store.getOrCreateUser("0xabc").weeklyXp[weekKey()], 42);
});
