import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACHIEVEMENTS,
  BOND_TARGET_USD,
  MISSIONS,
  TIER_CONFIGS,
  XP_AWARDS,
  dayKey,
  freshGameSettings,
  gameSettingProblem,
  mergeGameSettings,
  tradeXpForIndex,
  tradeXpOnCurve,
  type ServerEvent,
  type TokenConcept,
} from "@cookout/shared";
import { RoundEngine } from "./engine.js";
import { Store } from "./store.js";

function setup() {
  const store = new Store();
  const events: ServerEvent[] = [];
  const engine = new RoundEngine(store, (_id, e) => events.push(e));
  const concept: TokenConcept = {
    id: store.id(),
    creatorAddress: "0x00000000000000000000000000000000000000c1",
    name: "Config Coin",
    symbol: "CFG",
    theme: "test",
    status: "shortlisted",
    votes: 5,
    createdAt: 0,
  };
  store.concepts.set(concept.id, concept);
  return { store, engine, concept };
}

const A = "0x00000000000000000000000000000000000000aa";

test("defaults are seeded from the compiled constants", () => {
  const g = freshGameSettings();
  assert.equal(g.bondTargetUsd, BOND_TARGET_USD);
  assert.deepEqual(g.tiers.standard, TIER_CONFIGS.standard);
  assert.equal(g.xp.participation, XP_AWARDS.participation);
  assert.equal(Object.keys(g.missions).length, MISSIONS.length);
  assert.equal(Object.keys(g.achievements).length, ACHIEVEMENTS.length);
  assert.equal(g.modes.endurance.minutes, null);
});

test("editing settings never mutates the constants themselves", () => {
  const g = freshGameSettings();
  g.tiers.standard.tradeFeeBps = 9999;
  g.xp.participation = 9999;
  assert.notEqual(TIER_CONFIGS.standard.tradeFeeBps, 9999);
  assert.notEqual(XP_AWARDS.participation, 9999);
  assert.equal(freshGameSettings().tiers.standard.tradeFeeBps, TIER_CONFIGS.standard.tradeFeeBps);
});

test("merge fills in new content without clobbering stored edits", () => {
  const stored = freshGameSettings();
  stored.bondTargetUsd = 12_345;
  stored.xp.participation = 99;
  // Simulate a snapshot written before a quest and an achievement shipped.
  delete (stored.missions as Record<string, unknown>).d_play_2;
  delete (stored.achievements as Record<string, unknown>).first_blood;

  const merged = mergeGameSettings(stored);
  assert.equal(merged.bondTargetUsd, 12_345, "the operator's edit survives");
  assert.equal(merged.xp.participation, 99);
  assert.ok(merged.missions.d_play_2, "a quest missing from the snapshot comes back at its default");
  assert.ok(merged.achievements.first_blood);
  assert.equal(mergeGameSettings(undefined).bondTargetUsd, BOND_TARGET_USD);
});

test("guardrails refuse values that would break the engine", () => {
  assert.match(gameSettingProblem("tiers.standard.maxDurationSeconds", 0) ?? "", /greater than zero/);
  assert.match(gameSettingProblem("tiers.standard.initialEthLiquidity", -1) ?? "", /greater than zero/);
  assert.match(gameSettingProblem("tiers.standard.tradeFeeBps", -5) ?? "", /negative/);
  assert.match(gameSettingProblem("tiers.standard.tradeFeeBps", 10_001) ?? "", /100%/);
  assert.match(gameSettingProblem("bondTargetUsd", 0) ?? "", /greater than zero/);
  assert.match(gameSettingProblem("missions.d_play_2.target", 0) ?? "", /greater than zero/);
  assert.match(gameSettingProblem("dailyActiveCount", 0) ?? "", /at least one/);
  // Legitimate values pass, and Endurance's null match length is allowed.
  assert.equal(gameSettingProblem("tiers.standard.tradeFeeBps", 120), null);
  assert.equal(gameSettingProblem("modes.endurance.minutes", null), null);
  assert.equal(gameSettingProblem("modes.blitz.minutes", 5), null);
  assert.equal(gameSettingProblem("xp.participation", 0), null);
});

test("a tier fee edit reaches the next round that's scheduled", () => {
  const { store, engine, concept } = setup();
  store.settings.game.tiers.standard.tradeFeeBps = 250;
  store.settings.game.tiers.standard.maxDurationSeconds = 111;
  const round = engine.scheduleRound(concept, "standard", 1_000_000);
  assert.equal(round.config.tradeFeeBps, 250);
  assert.equal(round.config.maxDurationSeconds, 111);
  // …and the round holds a copy, so a later edit can't rewrite history.
  store.settings.game.tiers.standard.tradeFeeBps = 999;
  assert.equal(round.config.tradeFeeBps, 250);
});

test("the bond target is configurable and priced at the live ETH rate", () => {
  const { store, engine, concept } = setup();
  store.ethUsd = 2000;
  store.settings.game.bondTargetUsd = 80_000;
  assert.equal(store.bondTargetEth(), 40);
  const round = engine.scheduleRound(concept, "standard", 1_000_000);
  assert.equal(round.config.graduationMcap, 40);
});

test("mode settings drive rug rules and the pull-up cap", () => {
  const { store, engine, concept } = setup();
  concept.mode = "classic";
  store.settings.game.modes.classic.rugRules = false;
  store.settings.game.modes.classic.pullUpCap = 7.5;
  const round = engine.scheduleRound(concept, "standard", 1_000_000);
  assert.equal(round.config.rugRules, false);
  assert.equal(round.config.auctionMaxRaise, 7.5);
  // Disabling a mode is reflected by the resolver the launch routes read.
  assert.equal(store.modeEnabled("classic"), true);
  store.settings.game.modes.classic.disabled = true;
  assert.equal(store.modeEnabled("classic"), false);
});

test("XP payouts come from settings", () => {
  const { store } = setup();
  store.settings.game.xp.win_trade = 1234;
  assert.equal(store.xpFor("win_trade"), 1234);
  assert.equal(store.xpFor("participation"), XP_AWARDS.participation, "untouched events keep their default");
});

test("the trade-XP curve and its caps are retunable", () => {
  assert.equal(tradeXpForIndex(1), 5, "the default curve is unchanged");
  assert.equal(tradeXpOnCurve(1, { base: 20, decay: 0.5 }), 20);
  assert.equal(tradeXpOnCurve(2, { base: 20, decay: 0.5 }), 10);

  const { store } = setup();
  store.settings.game.tradeXp.dailyCap = 7;
  assert.equal(store.awardTradeXp(A, 100), 7, "the daily cap is enforced from settings");
  assert.equal(store.awardTradeXp(A, 100), 0, "and it's a running total");
});

test("quests honour configured targets, payouts and the enabled switch", () => {
  const { store } = setup();
  const now = Date.parse("2026-08-04T12:00:00Z");
  const daily = store.missionDefs("daily", now);
  assert.ok(daily.length > 0);

  const first = daily[0]!;
  store.settings.game.missions[first.id] = { target: 3, xp: 777, enabled: true };
  const retuned = store.missionDefs("daily", now).find((m) => m.id === first.id)!;
  assert.equal(retuned.target, 3);
  assert.equal(retuned.xp, 777);

  // Switching a quest off removes it from the live board entirely.
  store.settings.game.missions[first.id]!.enabled = false;
  assert.equal(
    store.missionDefs("daily", now).some((m) => m.id === first.id),
    false,
  );
  assert.equal(
    store.missionStatus(A, now).some((m) => m.id === first.id),
    false,
  );
});

test("the daily rotation size is configurable", () => {
  const { store } = setup();
  const now = Date.parse("2026-08-04T12:00:00Z");
  assert.equal(store.missionDefs("daily", now).length, 4, "the default board is four");
  store.settings.game.dailyActiveCount = 7;
  assert.equal(store.missionDefs("daily", now).length, 7);
  store.settings.game.dailyActiveCount = 1;
  assert.equal(store.missionDefs("daily", now).length, 1);
});

test("completing a retuned quest pays the configured XP", () => {
  const { store } = setup();
  const now = Date.parse("2026-08-04T12:00:00Z");
  const quest = store.missionDefs("daily", now)[0]!;
  store.settings.game.missions[quest.id] = { target: 1, xp: 500, enabled: true };
  const before = store.getOrCreateUser(A).xp;
  store.trackActivity(A, quest.metric, 1, now);
  const gained = store.getOrCreateUser(A).xp - before;
  assert.ok(gained >= 500, `expected at least the configured 500 XP, got ${gained}`);
  assert.ok(store.getOrCreateUser(A).missionsDone[`${dayKey(now)}:${quest.id}`]);
});

test("achievements honour configured rarity, payout and the enabled switch", () => {
  const { store } = setup();
  store.settings.game.achievementXp.legendary = 5000;
  store.settings.game.achievements.first_blood = { rarity: "legendary", enabled: true };
  const before = store.getOrCreateUser(A).xp;
  assert.equal(store.grantAchievement(A, "first_blood"), true);
  assert.equal(store.getOrCreateUser(A).xp - before, 5000, "paid at the configured rarity");

  // A disabled achievement is never granted…
  store.settings.game.achievements.diamond_hands = { rarity: "rare", enabled: false };
  assert.equal(store.grantAchievement(A, "diamond_hands"), false);
  assert.equal(store.getOrCreateUser(A).achievements.includes("diamond_hands"), false);
  // …but one already earned is never taken away.
  assert.equal(store.getOrCreateUser(A).achievements.includes("first_blood"), true);
});

test("game settings survive a snapshot round-trip", () => {
  const { store } = setup();
  store.settings.game.bondTargetUsd = 55_000;
  store.settings.game.tiers.degen.tradeFeeBps = 333;
  store.settings.game.missions.d_play_2 = { target: 9, xp: 9, enabled: false };

  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.settings.game.bondTargetUsd, 55_000);
  assert.equal(restored.tierConfig("degen").tradeFeeBps, 333);
  assert.equal(restored.settings.game.missions.d_play_2!.enabled, false);
});
