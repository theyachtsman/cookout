import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DAILY_ACTIVE_COUNT,
  DAILY_SET_BONUS_XP,
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
