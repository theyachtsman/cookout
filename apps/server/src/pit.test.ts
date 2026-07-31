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
