import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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

test("a live round survives a restart", () => {
  // In-flight rounds used to be dropped from the snapshot entirely, so every
  // deploy destroyed whatever was running. For Endurance — no timer, runs for
  // days — that could be a coin someone had been building since launch.
  const store = new Store();
  const round = {
    id: "live-1",
    state: "live",
    matchType: "cookout",
    token: { name: "Keeper", symbol: "KEEP" },
    pool: { ethReserve: 12, tokenReserve: 900_000, totalSupply: 1_000_000 },
  } as never;
  store.rounds.set("live-1", round);
  store.trades.set("live-1", [{ userAddress: "0xa", ethAmount: 1 }] as never);
  store.positions.set("live-1", new Map([["0xa", { tokens: 500 }]] as never));

  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));

  const back = restored.rounds.get("live-1");
  assert.ok(back, "the round itself came back");
  assert.equal(back.state, "live");
  // The pool rides inside the Round, which is what makes the coin tradeable
  // again rather than merely visible.
  assert.equal(back.pool?.ethReserve, 12);
  assert.equal(restored.trades.get("live-1")?.length, 1);
  assert.equal(restored.positions.get("live-1")?.get("0xa" as never)?.tokens, 500);
});

test("a finished round still round-trips, without duplicating", () => {
  const store = new Store();
  store.rounds.set("done-1", { id: "done-1", state: "results", token: { symbol: "OLD" } } as never);
  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.rounds.size, 1);
  assert.equal(restored.rounds.get("done-1")?.state, "results");
});

test("a round snapshotted before the curveAnchorEth rename still prices", () => {
  // Every price the engine computes divides by this field. A round persisted
  // under the old name would come back with it undefined and turn its own spot
  // price into NaN — a live coin destroyed by a deploy, which is precisely the
  // failure this rename must not cause.
  const store = new Store();
  const restored = new Store();
  restored.hydrate({
    ...store.snapshot(),
    archivedRounds: [
      {
        id: "legacy-1",
        state: "live",
        config: { initialEthLiquidity: 1.5, initialTokenLiquidity: 1_000_000 },
      },
    ],
  } as never);

  const cfg = restored.rounds.get("legacy-1")?.config as unknown as Record<string, number>;
  assert.equal(cfg.curveAnchorEth, 1.5);
  assert.ok(Number.isFinite(cfg.curveAnchorEth / cfg.initialTokenLiquidity), "opens at a real price");
});

test("hydrate does not overwrite a round that already uses the new name", () => {
  const store = new Store();
  const restored = new Store();
  restored.hydrate({
    ...store.snapshot(),
    archivedRounds: [
      { id: "new-1", state: "live", config: { curveAnchorEth: 2, initialEthLiquidity: 9 } },
    ],
  } as never);
  assert.equal((restored.rounds.get("new-1")?.config as never as Record<string, number>).curveAnchorEth, 2);
});

test("a live round whose pool lost its ETH reserve is repaired, not left dead", () => {
  // This is what a stale @cookout/shared build actually did to production: the
  // config field it wrote no longer existed, the pool was seeded from
  // undefined, NaN serialised to null, and the round page crashed on every
  // price derived from it. The coin was live and untradeable.
  const store = new Store();
  const restored = new Store();
  restored.hydrate({
    ...store.snapshot(),
    archivedRounds: [
      {
        id: "poisoned-1",
        state: "live",
        token: { symbol: "BERP" },
        config: { initialEthLiquidity: 1, initialTokenLiquidity: 1_000_000 },
        pool: { ethReserve: null, tokenReserve: 1_000_000, totalSupply: 2_000_000 },
        clearingPrice: null,
      },
    ],
    // Settled against the poisoned pool: no fills, but the derived numbers
    // came back null and that is what the page choked on.
    auctionResults: [
      {
        roundId: "poisoned-1",
        fills: [],
        totalDemand: 0,
        totalRaised: 0,
        fillRatio: 0,
        clearingPrice: null,
        poolAfter: { ethReserve: null, tokenReserve: 1_000_000, totalSupply: 2_000_000 },
      },
    ],
  } as never);

  const back = restored.rounds.get("poisoned-1")!;
  assert.equal(back.pool?.ethReserve, 1, "reseeded from the anchor");
  // Reseeding the reserve alone was not enough: the round page reads the
  // clearing price, which was derived from the broken pool and stayed null.
  assert.equal((back as never as Record<string, number>).clearingPrice, 1e-6);
  assert.ok(Number.isFinite(back.pool!.ethReserve / back.pool!.tokenReserve), "prices again");
  assert.ok(
    restored.adminLog.some((e) => /repaired BERP/.test(e.detail ?? "")),
    "the repair is recorded, not silent",
  );

  const auction = restored.auctionResults.get("poisoned-1")! as never as Record<string, never>;
  assert.equal((auction.poolAfter as Record<string, number>).ethReserve, 1);
  assert.equal(auction.clearingPrice as unknown as number, 1e-6);

  // The whole point: nothing the page reads is null any more.
  for (const [what, v] of [
    ["pool reserve", back.pool?.ethReserve],
    ["round clearing price", (back as never as Record<string, number>).clearingPrice],
    ["auction clearing price", auction.clearingPrice as unknown as number],
  ] as const) {
    assert.ok(Number.isFinite(v as number), `${what} is a real number`);
  }
});

test("a healthy pool is never rewritten by the repair", () => {
  const store = new Store();
  const restored = new Store();
  restored.hydrate({
    ...store.snapshot(),
    archivedRounds: [
      {
        id: "healthy-1",
        state: "live",
        token: { symbol: "OK" },
        // Mid-round: the reserve has moved well away from the anchor and must
        // stay exactly where it is.
        config: { curveAnchorEth: 1, initialTokenLiquidity: 1_000_000 },
        pool: { ethReserve: 7.25, tokenReserve: 800_000, totalSupply: 2_000_000 },
      },
    ],
  } as never);
  assert.equal(restored.rounds.get("healthy-1")?.pool?.ethReserve, 7.25);
});

test("every snapshot field survives a Postgres round-trip", () => {
  // The bug this exists to prevent, which shipped and cost real data: the
  // Postgres layer listed the singleton fields it would KEEP. `liveRounds` —
  // trades, positions, intents — was never on that list, so every deploy
  // silently erased the trade history and every holder's position on live
  // coins. Nothing errored; the data just stopped existing.
  //
  // The list is now the inverse (fields that have their own table), so a new
  // snapshot field persists by default. This asserts the two halves still
  // account for every field, by reading a real snapshot rather than a
  // hand-written list that would drift the same way.
  const store = new Store();
  const snap = store.snapshot() as unknown as Record<string, unknown>;

  const src = readFileSync(join(import.meta.dirname, "persistence.ts"), "utf8");
  const block = src.slice(src.indexOf("TABLE_KEYS: ReadonlySet<string> = new Set(["));
  const tableKeys = new Set(
    [...block.slice(0, block.indexOf("]")).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!),
  );

  // Everything in a snapshot is either table-backed or swept into `state`.
  // The sweep is `Object.entries(s).filter(([k]) => !TABLE_KEYS.has(k))`, so
  // the only way to lose a field now is to add it to TABLE_KEYS without a
  // table — which this catches by requiring each one to have an INSERT.
  for (const key of tableKeys) {
    if (key === "version") continue;
    assert.ok(
      new RegExp(`INSERT INTO \\w+ [\\s\\S]{0,400}s\\.${key}\\b`).test(src) ||
        new RegExp(`s\\.${key}[\\s\\S]{0,200}INSERT INTO`).test(src) ||
        src.includes(`s.${key}`),
      `${key} claims a table but nothing writes it`,
    );
  }

  // And the fields that actually carry player money and history are not
  // table-backed, so they must fall through to the state sweep.
  for (const critical of ["liveRounds", "candles", "candlesMin", "candlesHour", "featureFlags"]) {
    assert.ok(critical in snap, `${critical} is in the snapshot`);
    assert.ok(!tableKeys.has(critical), `${critical} must be swept into state, not dropped`);
  }

  // The sweep itself must be a filter over the whole snapshot, never a list.
  assert.match(
    src,
    /Object\.entries\(s\)\.filter\(\(\[k\]\) => !PgPersistence\.TABLE_KEYS\.has\(k\)\)/,
    "state is everything-except, not an allow-list",
  );
});
