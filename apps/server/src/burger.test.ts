import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "./store.js";
import {
  awardBurger,
  awardBurgerOneTime,
  awardBurgerXpMilestones,
  purchaseBurgers,
  adminAdjustBurgers,
  burgerAnalytics,
} from "./burger.js";

const A = "0x00000000000000000000000000000000000000aa";
const BOT = "0xb07000000000000000000000000000000000beef";

test("Burger award: pays the configured amount, records a txn, tracks earned", () => {
  const store = new Store();
  const paid = awardBurger(store, A, "match_complete");
  const u = store.getOrCreateUser(A);
  const rule = store.settings.burger.rules.find((r) => r.source === "match_complete")!;
  assert.equal(paid, rule.amount);
  assert.equal(u.burgerBalance, rule.amount);
  assert.equal(u.burgerEarned, rule.amount);
  assert.equal(u.burgerLedger?.length, 1);
  assert.equal(u.burgerLedger?.[0]?.category, "reward");
});

test("Burger award: disabled economy and bots earn nothing", () => {
  const store = new Store();
  assert.equal(awardBurger(store, BOT, "match_complete"), 0, "bots never earn");
  store.settings.burger.enabled = false;
  assert.equal(awardBurger(store, A, "match_complete"), 0, "disabled economy pays nothing");
});

test("Burger award: cooldown blocks repeats within the window", () => {
  const store = new Store();
  const rule = store.settings.burger.rules.find((r) => r.source === "match_complete")!;
  rule.cooldownSec = 60;
  const t0 = Date.UTC(2026, 6, 14, 12);
  assert.ok(awardBurger(store, A, "match_complete", { now: t0 }) > 0);
  assert.equal(awardBurger(store, A, "match_complete", { now: t0 + 30_000 }), 0, "still cooling down");
  assert.ok(awardBurger(store, A, "match_complete", { now: t0 + 61_000 }) > 0, "cooldown elapsed");
});

test("Burger one-time milestone: claimable exactly once", () => {
  const store = new Store();
  const first = awardBurgerOneTime(store, A, "first_match");
  assert.ok(first > 0);
  assert.equal(awardBurgerOneTime(store, A, "first_match"), 0, "no second claim");
});

test("Burger XP milestones: a multi-level jump pays each crossed tier once", () => {
  const store = new Store();
  const ms = store.settings.burger.xpMilestones.filter((m) => m.enabled);
  const expected = ms.filter((m) => m.level <= 10).reduce((s, m) => s + m.amount, 0);
  const paid = awardBurgerXpMilestones(store, A, 10);
  assert.equal(paid, expected, "all milestones up to level 10 pay");
  assert.equal(awardBurgerXpMilestones(store, A, 10), 0, "re-running the same level pays nothing");
});

test("Burger purchase: mints $BURG, debits Cook Out balance, routes revenue", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  u.arenaBalance = 10;
  const rate = store.settings.burger.burgersPerEth;
  const jackpotBefore = store.jackpotPool;
  const out = purchaseBurgers(store, A, 2);
  assert.equal(out.burgers, Math.floor(2 * rate));
  assert.equal(u.burgerBalance, out.burgers);
  assert.equal(Math.round((u.arenaBalance ?? 0) * 1e6) / 1e6, 8, "2 pETH debited");
  // Revenue routed: jackpot slice moved into the live pool, every slice logged.
  const alloc = store.settings.burger.revenueAllocation;
  const total = Object.values(alloc).reduce((s, v) => s + v, 0);
  assert.ok(store.jackpotPool > jackpotBefore, "jackpot got its slice");
  assert.ok(Math.abs(store.jackpotPool - (jackpotBefore + (2 * alloc.jackpot) / total)) < 1e-9);
  assert.ok(store.burgerRevenueLedger.length >= 1, "revenue ledger populated");
  assert.ok(Math.abs(store.burgerRevenueEth - 2) < 1e-9, "full purchase accounted");
});

test("Burger purchase: rejects an underfunded buy", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  u.arenaBalance = 0.001;
  assert.throws(() => purchaseBurgers(store, A, 5), /Not enough/);
});

test("Burger admin adjust: grant adds, removal clamps at zero", () => {
  const store = new Store();
  assert.equal(adminAdjustBurgers(store, A, 100, "welcome"), 100);
  assert.equal(adminAdjustBurgers(store, A, -40), 60);
  assert.equal(adminAdjustBurgers(store, A, -1000), 0, "cannot go negative");
});

test("Burger analytics: aggregates earned / purchased / holders", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  u.arenaBalance = 10;
  awardBurger(store, A, "match_complete");
  purchaseBurgers(store, A, 1);
  const a = burgerAnalytics(store);
  assert.ok(a.totalEarned > 0);
  assert.ok(a.totalPurchased > 0);
  assert.equal(a.holders, 1);
  assert.ok(a.bySource.some((s) => s.source === "match_complete"));
});
