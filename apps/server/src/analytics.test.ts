import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey } from "@cookout/shared";
import { buildAnalytics, isRealPlayer } from "./analytics.js";
import { Store } from "./store.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-04T12:00:00Z");

function player(store: Store, address: string, joinedDaysAgo: number, activeDaysAgo: number[] = []) {
  const u = store.getOrCreateUser(address);
  u.createdAt = NOW - joinedDaysAgo * DAY;
  for (const d of activeDaysAgo) u.dailyXp[dayKey(NOW - d * DAY)] = 10;
  return u;
}

test("bots and Goon Squad accounts are excluded from player figures", () => {
  const store = new Store();
  player(store, "0x00000000000000000000000000000000000000a1", 1);
  const bot = store.getOrCreateUser("0xb07000000000000000000000000000000000" + "0001");
  const goon = store.getOrCreateUser("0x900d000000000000000000000000000000000001");
  goon.isAI = true;

  assert.equal(isRealPlayer(store.getOrCreateUser("0x00000000000000000000000000000000000000a1")), true);
  assert.equal(isRealPlayer(bot), false, "paper bots never count");
  assert.equal(isRealPlayer(goon), false, "AI accounts never count");

  const a = buildAnalytics(store, { days: 30 }, NOW);
  assert.equal(a.players.total, 1, "a populated demo lobby can't flatter the numbers");
});

test("signups and activity are zero-filled across the whole window", () => {
  const store = new Store();
  player(store, "0x00000000000000000000000000000000000000a1", 0, [0]);
  player(store, "0x00000000000000000000000000000000000000a2", 2, [2]);

  const a = buildAnalytics(store, { days: 7 }, NOW);
  assert.equal(a.players.signups.length, 7, "every day in the range is present");
  assert.equal(a.players.active.length, 7);
  // A quiet day reports zero rather than being dropped, so a gap reads as a gap.
  const quiet = a.players.signups.find((p) => p.day === dayKey(NOW - 5 * DAY))!;
  assert.equal(quiet.value, 0);
  assert.equal(a.players.signups.at(-1)!.value, 1, "today's signup lands on today");
  assert.equal(a.players.new, 2);
});

test("DAU and WAU count distinct players, not visits", () => {
  const store = new Store();
  // Two players active today, one of them also earlier in the week.
  player(store, "0x00000000000000000000000000000000000000a1", 10, [0, 3]);
  player(store, "0x00000000000000000000000000000000000000a2", 10, [0]);
  player(store, "0x00000000000000000000000000000000000000a3", 10, [20]);

  const a = buildAnalytics(store, { days: 30 }, NOW);
  assert.equal(a.players.dau, 2);
  assert.equal(a.players.wau, 2, "the player last seen 20 days ago isn't weekly-active");
});

test("retention only counts cohorts old enough to judge", () => {
  const store = new Store();
  // Joined 10 days ago, came back the next day → counts toward D1 retained.
  player(store, "0x00000000000000000000000000000000000000a1", 10, [9]);
  // Joined 10 days ago, never came back → counts toward D1 cohort, not retained.
  player(store, "0x00000000000000000000000000000000000000a2", 10, []);
  // Joined today — can't have a D1 yet, so must not drag the rate down.
  player(store, "0x00000000000000000000000000000000000000a3", 0, [0]);

  const a = buildAnalytics(store, { days: 30 }, NOW);
  assert.equal(a.players.retention.d1.cohort, 2, "today's signup is excluded from D1");
  assert.equal(a.players.retention.d1.retained, 1);
  assert.equal(a.players.retention.d1.pct, 50);
  // Nobody is old enough for D30 within a 30-day window that starts at signup.
  assert.equal(a.players.retention.d30.cohort, 0);
  assert.equal(a.players.retention.d30.pct, 0, "an unjudgeable cohort reports 0, not NaN");
});

test("trading totals count volume, trades and distinct traders", () => {
  const store = new Store();
  const mk = (at: number, address: string, eth: number) => ({
    id: store.id(),
    roundId: "r1",
    userAddress: address,
    side: "buy" as const,
    ethAmount: eth,
    tokenAmount: 1,
    price: 1,
    fee: 0,
    at,
    isCreator: false,
  });
  store.trades.set("r1", [
    mk(NOW - DAY, "0xa1", 1),
    mk(NOW - DAY, "0xa2", 2),
    mk(NOW, "0xa1", 3),
    mk(NOW - 60 * DAY, "0xa3", 99), // outside the window
  ]);

  const a = buildAnalytics(store, { days: 7 }, NOW);
  assert.equal(a.trading.volumeEth, 6, "only trades inside the window count");
  assert.equal(a.trading.trades, 3);
  assert.equal(a.trading.traders, 2, "distinct traders, not trades");
  assert.equal(a.trading.avgTradeEth, 2);
});

test("empty platform reports zeros rather than blowing up", () => {
  const a = buildAnalytics(new Store(), { days: 30 }, NOW);
  assert.equal(a.players.total, 0);
  assert.equal(a.trading.avgTradeEth, 0);
  assert.equal(a.matches.graduationRate, 0);
  assert.equal(a.pit.predictionAccuracy, 0);
  assert.equal(a.players.retention.d7.pct, 0);
  assert.equal(a.players.signups.length, 30);
});

test("the range is honoured", () => {
  const store = new Store();
  const a7 = buildAnalytics(store, { days: 7 }, NOW);
  const a90 = buildAnalytics(store, { days: 90 }, NOW);
  assert.equal(a7.players.signups.length, 7);
  assert.equal(a90.players.signups.length, 90);
  assert.equal(a7.range, 7);
});
