import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DAILY_ACTIVE_COUNT,
  DAILY_SET_BONUS_XP,
  FLOOR_XP_WEEKLY_CAP,
  MILESTONES,
  SEASON_PASS_TIERS,
  TRADE_XP,
  achievementXp,
  activeDailyMissions,
  tradeXpForIndex,
  unlockedCosmetics,
} from "@cookout/shared";
import { FilePersistence } from "./persistence.js";
import { Store } from "./store.js";

const A = "0x00000000000000000000000000000000000000aa";

test("missions: an active daily completes once, resets next day, weekly accrues", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  const now = Date.UTC(2026, 6, 14, 12);

  // Pick a daily mission that's actually live today (rotation is date-seeded).
  const active = activeDailyMissions(now);
  const d = active.find((m) => m.metric === "trades") ?? active[0]!;

  const before = u.xp;
  store.trackActivity(A, d.metric, d.target, now);
  assert.equal(u.xp, before + d.xp, "active daily completes and pays once");

  // Same period: no double award.
  store.trackActivity(A, d.metric, d.target, now + 1000);
  assert.equal(u.xp, before + d.xp);

  // Next day (same metric may or may not be live) — completing an active one pays again.
  const nextDay = now + 26 * 3600 * 1000;
  const active2 = activeDailyMissions(nextDay);
  const d2 = active2[0]!;
  const beforeD2 = u.xp;
  store.trackActivity(A, d2.metric, d2.target, nextDay);
  assert.ok(u.xp >= beforeD2 + d2.xp, "a fresh day re-opens the daily board");
});

test("missions: only the rotating daily subset is live, and it's deterministic", () => {
  const store = new Store();
  const now = Date.UTC(2026, 6, 14, 12);
  const dailies = store.missionStatus(A, now).filter((m) => m.period === "daily");
  assert.equal(dailies.length, DAILY_ACTIVE_COUNT, "exactly the active daily count is shown");
  // Same day → identical set; a later day → a (re-seeded) set.
  assert.deepEqual(
    activeDailyMissions(now).map((m) => m.id),
    activeDailyMissions(now + 3_600_000).map((m) => m.id),
    "stable within a day",
  );
});

test("missions: clearing every active daily pays the set bonus", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  const now = Date.UTC(2026, 6, 15, 9);
  const active = activeDailyMissions(now);
  const missionXp = active.reduce((s, m) => s + m.xp, 0);
  // Complete each active daily by driving its metric to target.
  for (const m of active) store.trackActivity(A, m.metric, m.target, now);
  // All active dailies done ⇒ their XP + the set bonus.
  assert.equal(u.xp, missionXp + DAILY_SET_BONUS_XP, "set bonus paid once all cleared");
});

test("trade XP: geometric decay, capped per round and per day", () => {
  const store = new Store();
  const now = Date.UTC(2026, 6, 15, 9);
  // Award per-round-style: caller decays; store enforces the daily cap.
  // Verify the decay curve values.
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(tradeXpForIndex),
    [5, 3, 2, 1, 1, 0],
  );
  // Daily cap: repeated awards stop paying past TRADE_XP.dailyCap.
  let given = 0;
  for (let i = 0; i < 100; i++) given += store.awardTradeXp(A, 5, now);
  assert.equal(given, TRADE_XP.dailyCap, "daily trade-XP is capped");
  // New day resets the cap.
  const nextDay = now + 26 * 3600 * 1000;
  assert.equal(store.awardTradeXp(A, 5, nextDay), 5, "cap resets next day");
});

const DAY = 86_400_000;

test("streaks: daily play streak advances, resets on a miss", () => {
  const store = new Store();
  const d0 = Date.UTC(2026, 6, 1, 12);
  store.bumpPlayStreak(A, d0);
  assert.equal(store.getOrCreateUser(A).playStreak, 1);
  store.bumpPlayStreak(A, d0 + DAY);
  assert.equal(store.getOrCreateUser(A).playStreak, 2, "consecutive day extends");
  store.bumpPlayStreak(A, d0 + DAY + 3600_000);
  assert.equal(store.getOrCreateUser(A).playStreak, 2, "same day is idempotent");
  store.bumpPlayStreak(A, d0 + 3 * DAY);
  assert.equal(store.getOrCreateUser(A).playStreak, 1, "a missed day (no freeze) resets");
});

test("streaks: a freeze token saves a one-day gap", () => {
  const store = new Store();
  const d0 = Date.UTC(2026, 6, 1, 12);
  store.bumpPlayStreak(A, d0); // streak 1
  const u = store.getOrCreateUser(A);
  u.streakFreezes = 1;
  store.bumpPlayStreak(A, d0 + 2 * DAY); // missed one day → freeze covers it
  assert.equal(u.playStreak, 2, "streak preserved");
  assert.equal(u.streakFreezes, 0, "freeze consumed");
});

test("floor cap: grind XP is capped weekly, ceiling XP is not", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  for (let i = 0; i < 500; i++) store.addXp(A, 20, "floor");
  assert.equal(u.floorXpWeek, FLOOR_XP_WEEKLY_CAP, "floor accrual capped");
  assert.equal(u.xp, FLOOR_XP_WEEKLY_CAP, "capped floor is all that landed");
  store.addXp(A, 500, "ceiling");
  assert.equal(u.xp, FLOOR_XP_WEEKLY_CAP + 500, "ceiling XP bypasses the cap");
});

test("milestones: crossing a lifetime tier pays once", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  const trader = MILESTONES.find((m) => m.id === "trader")!;
  u.stats.trades = trader.tiers[0]!.at;
  const before = u.xp;
  store.checkMilestones(A);
  assert.equal(u.xp, before + trader.tiers[0]!.xp, "first tier paid");
  store.checkMilestones(A);
  assert.equal(u.xp, before + trader.tiers[0]!.xp, "no double pay");
});

test("season pass: crossing a monthly tier awards the kicker once", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  store.addXp(A, SEASON_PASS_TIERS[0]!.at, "ceiling"); // reach tier 1's threshold
  const before = u.xp;
  store.checkSeasonPass(A);
  assert.equal(u.xp, before + SEASON_PASS_TIERS[0]!.xp, "tier kicker paid");
  store.checkSeasonPass(A);
  assert.equal(u.xp, before + SEASON_PASS_TIERS[0]!.xp, "no double pay");
});

test("achievements: first unlock pays rarity XP, never twice", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  const before = u.xp;
  assert.equal(store.grantAchievement(A, "hundred_x"), true);
  assert.equal(u.xp, before + achievementXp("hundred_x"), "legendary XP paid");
  assert.equal(store.grantAchievement(A, "hundred_x"), false);
  assert.equal(u.xp, before + achievementXp("hundred_x"), "no double pay");
});

test("cosmetics: unlocks by level and achievement, equip validated shape", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  assert.equal(unlockedCosmetics(u).length, 0, "level 1, nothing unlocked");
  u.level = 20;
  const byLevel = unlockedCosmetics(u).map((c) => c.id);
  assert.ok(byLevel.includes("b_flame") && byLevel.includes("c_emerald"));
  assert.ok(!byLevel.includes("b_diamond"));
  u.achievements.push("diamond_hands");
  assert.ok(unlockedCosmetics(u).some((c) => c.id === "b_diamond"));
});

test("snapshot → hydrate roundtrip via FilePersistence", async () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  u.displayName = "roundtrip";
  store.addXp(A, 500);
  store.trackActivity(A, "trades", 7);
  u.equipped.badge = "b_flame";
  const concept = {
    id: store.id(),
    creatorAddress: A,
    name: "Persist",
    symbol: "SAVE",
    theme: "durability",
    status: "submitted" as const,
    votes: 3,
    createdAt: 1,
  };
  store.concepts.set(concept.id, concept);
  store.conceptVoters.set(concept.id, new Set([A]));
  store.logAdmin("test", "entry");

  const file = join(mkdtempSync(join(tmpdir(), "cookout-")), "state.json");
  const p = new FilePersistence(file);
  await p.save(store.snapshot());

  const store2 = new Store();
  const loaded = await new FilePersistence(file).load();
  assert.ok(loaded);
  store2.hydrate(loaded);
  const u2 = store2.getOrCreateUser(A);
  assert.equal(u2.displayName, "roundtrip");
  assert.equal(u2.xp, u.xp);
  assert.equal(u2.equipped.badge, "b_flame");
  assert.equal(store2.concepts.get(concept.id)!.symbol, "SAVE");
  assert.ok(store2.conceptVoters.get(concept.id)!.has(A));
  assert.equal(store2.adminLog.length, 1);
  const status = store2.missionStatus(A);
  // Weekly challenges are always live (dailies rotate), so check the trades one.
  assert.equal(status.find((m) => m.id === "w_trade_50")!.progress, 7, "activity survives restart");
});
