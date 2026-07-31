import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_SPECIAL_MAP, type TokenConcept } from "@cookout/shared";
import { RoundEngine } from "./engine.js";
import { enterPit, withdrawPit } from "./pit-pools.js";
import { resolvePitRound } from "./pit-results.js";
import { Store } from "./store.js";

function pitConcept(store: Store): TokenConcept {
  const c: TokenConcept = {
    id: store.id(),
    creatorAddress: "0xcreator000000000000000000000000000000000",
    name: "Goon Test",
    symbol: "GOON",
    theme: "test",
    matchType: "pit",
    pitDuration: "standard",
    status: "submitted",
    votes: 0,
    createdAt: Date.now(),
  };
  store.concepts.set(c.id, c);
  return c;
}

const alice = "0xa11ce0000000000000000000000000000000000";
const bob = "0xb0b0000000000000000000000000000000000000";

test("Pit prediction: main + House Special buckets, proportional, Double Down", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.getOrCreateUser(alice).arenaBalance = 10;
  store.getOrCreateUser(bob).arenaBalance = 10;
  const now = Date.now();
  const round = engine.schedulePitRound(pitConcept(store), now);
  // Deterministic config for clean math.
  round.pit!.pitFeeBps = 0;
  round.pit!.houseSpecial = HOUSE_SPECIAL_MAP.dead_market;
  round.pit!.mainAllocationBps = 7500;
  round.pit!.houseAllocationBps = 2500;
  round.pit!.doubleDownBonus = 0.2;

  // Alice: Main Timer (1.0) + House Special (0.5). Bob: Main Rug (1.0).
  enterPit(store, round, alice, { prediction: "timer", predictionStake: 1.0, houseSpecial: true, houseSpecialStake: 0.5 });
  enterPit(store, round, bob, { prediction: "rug", predictionStake: 1.0 });
  assert.ok(Math.abs(round.pit!.prediction.pot - 2.5) < 1e-9, "gross prediction pot");
  assert.equal(round.pit!.mainParticipants, 2);
  assert.equal(round.pit!.houseParticipants, 1);

  // End on the timer, dead market (finalMcap <= open) → House Special hits.
  round.state = "live";
  round.liveAt = now - 60_000;
  round.endedAt = now;
  round.endReason = "timer";
  round.graduated = false;
  const summary = resolvePitRound(store, round, {
    totalVolume: 0,
    peakMcap: 0,
    finalMcap: 0,
    finalPrice: 1,
    holderCount: 0,
    now,
  });
  const pit = summary.pit!;
  assert.equal(pit.outcome, "timer");
  assert.equal(pit.houseSpecial?.hit, true);
  // Buckets: main 75% of 2.5 = 1.875, house 25% = 0.625.
  const a = pit.players.find((p) => p.address === alice)!;
  assert.ok(Math.abs(a.predictionReward - 1.875) < 1e-9, "main reward (sole timer caller)");
  assert.ok(Math.abs(a.houseSpecialReward - 0.625) < 1e-9, "house reward (sole HS winner)");
  assert.ok(Math.abs(a.doubleDownBonus - 0.2) < 1e-9, "double down bonus");
  assert.ok(Math.abs(a.totalReward - 2.7) < 1e-9, "total reward");
  const b = pit.players.find((p) => p.address === bob)!;
  assert.equal(b.predictionCorrect, false);
  assert.equal(b.totalReward, 0);

  const ps = store.pitStatsOf(alice);
  assert.equal(ps.predictionWins, 1);
  assert.equal(ps.houseWins, 1);
  assert.equal(ps.doubleDowns, 1);
});

test("Pit: withdraw refunds the stake and clears the pool", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.getOrCreateUser(alice).arenaBalance = 5;
  const round = engine.schedulePitRound(pitConcept(store), Date.now());
  enterPit(store, round, alice, { prediction: "graduate", predictionStake: 1.0 });
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 4) < 1e-9);
  withdrawPit(store, round, alice);
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 5) < 1e-9, "refunded");
  assert.equal(round.pit!.prediction.pot, 0);
  assert.equal(round.pit!.mainParticipants, 0);
  assert.equal(store.pitEntryOf(round.id, alice), undefined);
});

test("Flame Trial: tier bar, stake refund on pass, tier XP, achievement", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.ethUsd = 100; // $ per pETH → easy tier math
  store.getOrCreateUser(alice).arenaBalance = 10;
  const now = Date.now();
  const round = engine.schedulePitRound(pitConcept(store), now);
  round.pit!.pitFeeBps = 0;

  // Stake 0.1 pETH = $10 → Henchman tier, whose bar is +30%.
  enterPit(store, round, alice, { trial: true, trialStake: 0.1 });
  assert.equal(round.pit!.trialParticipants, 1);
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 9.9) < 1e-9); // staked
  // Simulate a +35% run (stack 0.85 + 0.5 tokens @ price 1 = 1.35 vs 1.0 start).
  store.setPitStack(round.id, alice, 0.85);
  store.position(round.id, alice).tokens = 0.5;

  round.state = "live";
  round.liveAt = now - 60_000;
  round.endReason = "timer";
  round.graduated = false;
  const summary = resolvePitRound(store, round, {
    totalVolume: 1,
    peakMcap: 1,
    finalMcap: 1,
    finalPrice: 1,
    holderCount: 1,
    now,
    drawdown: new Map([[alice, 0]]),
  });
  const p = summary.pit!.players.find((x) => x.address === alice)!;
  assert.equal(p.trial, true);
  assert.equal(p.trialPassed, true);
  assert.equal(p.trialTier, "Henchman");
  assert.equal(p.trialRequiredBps, 3000); // higher stake, higher bar
  assert.equal(p.trialXp, 120);
  assert.ok(Math.abs((p.trialPnlPct ?? 0) - 0.35) < 1e-9);
  assert.ok(Math.abs(p.net) < 1e-9); // stake returned on a pass → net zero
  assert.equal(summary.pit!.trial.passed, 1);
  assert.equal(summary.pit!.trial.requiredPnlBps, 3000);
  // Stake came back in full; no creator fee credited (creator is the player).
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 10) < 1e-9);
  const ps = store.pitStatsOf(alice);
  assert.equal(ps.trialsWon, 1);
  assert.equal(ps.trialXp, 120);
  assert.ok(store.getOrCreateUser(alice).achievements.includes("first_flame"));
});

test("Flame Trial: missing the bar forfeits the stake, no creator reward", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.ethUsd = 100;
  store.getOrCreateUser(alice).arenaBalance = 10;
  const now = Date.now();
  const c = pitConcept(store);
  const round = engine.schedulePitRound(c, now);
  round.pit!.pitFeeBps = 0;
  const jackpotBefore = store.jackpotPool;
  const creatorBalBefore = store.getOrCreateUser(c.creatorAddress).arenaBalance ?? 0;

  // $10 Henchman needs +30%; a +10% run misses it.
  enterPit(store, round, alice, { trial: true, trialStake: 0.1 });
  store.setPitStack(round.id, alice, 0.6);
  store.position(round.id, alice).tokens = 0.5; // 0.6 + 0.5 = 1.1 → +10%

  round.state = "live";
  round.liveAt = now - 60_000;
  round.endReason = "timer";
  round.graduated = false;
  const summary = resolvePitRound(store, round, {
    totalVolume: 1,
    peakMcap: 1,
    finalMcap: 1,
    finalPrice: 1,
    holderCount: 1,
    now,
  });
  const p = summary.pit!.players.find((x) => x.address === alice)!;
  assert.equal(p.trialPassed, false);
  assert.equal(summary.pit!.trial.passed, 0);
  // Stake is gone (balance stays at 9.9), and it went to the house/jackpot,
  // never the creator.
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 9.9) < 1e-9);
  assert.ok(Math.abs((p.net ?? 0) + 0.1) < 1e-9); // net = -stake
  assert.ok(store.jackpotPool > jackpotBefore); // forfeit routed to the house
  assert.ok(Math.abs((store.getOrCreateUser(c.creatorAddress).arenaBalance ?? 0) - creatorBalBefore) < 1e-9);
  assert.equal(store.pitStatsOf(alice).trialsWon, 0);
});

test("Flame Trial: solo round arms on the creator's stake, ignoring the prediction side-pool", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.ethUsd = 100;
  const c = pitConcept(store);
  c.pitModes = { prediction: true, trading: false, trial: true };
  store.getOrCreateUser(alice).arenaBalance = 10;
  const now = Date.now();
  const round = engine.schedulePitRound(c, now);
  // With no trial stake, nothing arms — the prediction side-pool never drives it.
  assert.equal(engine.armPitLobby(round, now), false);
  enterPit(store, round, alice, { trial: true, trialStake: 0.1 });
  // One stake (the creator's) arms a quick countdown even with zero predictions.
  assert.equal(round.pit!.prediction.participants, 0);
  assert.equal(engine.armPitLobby(round, now), true);
  assert.equal(round.queueOpensAt, now + round.pit!.trialLobbySeconds * 1000);
});

test("Pit queue: an under-subscribed match cancels and refunds after its window", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.getOrCreateUser(alice).arenaBalance = 10;
  const now = Date.now();
  const round = engine.schedulePitRound(pitConcept(store), now);
  // One prediction bet — below the 2-bet quorum, so it never arms.
  enterPit(store, round, alice, { prediction: "graduate", predictionStake: 0.1 });
  assert.equal(round.pit!.prediction.participants, 1);
  assert.ok(!round.queueOpensAt);
  const staked = store.getOrCreateUser(alice).arenaBalance;
  assert.ok(Math.abs((staked ?? 0) - 9.9) < 1e-9);

  // Before the window closes, nothing happens.
  engine.tickTransitions(now + round.pit!.queueMaxSeconds * 1000 - 1000);
  assert.equal(round.state, "lobby");

  // Past the window with quorum unmet: cancelled + deposit refunded.
  engine.tickTransitions(now + round.pit!.queueMaxSeconds * 1000 + 1);
  assert.equal(round.state, "cancelled");
  assert.ok(Math.abs((store.getOrCreateUser(alice).arenaBalance ?? 0) - 10) < 1e-9);
});

test("Pit: an unclaimed bucket funds the weekly jackpot", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  store.getOrCreateUser(alice).arenaBalance = 5;
  const jackpotBefore = store.jackpotPool;
  const round = engine.schedulePitRound(pitConcept(store), Date.now());
  round.pit!.pitFeeBps = 0;
  enterPit(store, round, alice, { prediction: "graduate", predictionStake: 1.0 });
  round.state = "live";
  round.liveAt = Date.now() - 60_000;
  round.endReason = "timer"; // Alice predicted graduate — nobody correct
  round.graduated = false;
  resolvePitRound(store, round, {
    totalVolume: 1,
    peakMcap: 1,
    finalMcap: 1,
    finalPrice: 1,
    holderCount: 0,
    now: Date.now(),
  });
  assert.ok(store.jackpotPool > jackpotBefore, "unclaimed prediction bucket swept to jackpot");
});
