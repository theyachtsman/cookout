import { test } from "node:test";
import assert from "node:assert/strict";
import type { TokenConcept } from "@cookout/shared";
import { RoundEngine } from "./engine.js";
import { enterPit } from "./pit-pools.js";
import { resolvePitRound } from "./pit-results.js";
import { Store } from "./store.js";

function pitConcept(store: Store): TokenConcept {
  const c: TokenConcept = {
    id: store.id(),
    creatorAddress: "0xcreator000000000000000000000000000000000",
    name: "Swarm Test",
    symbol: "SWRM",
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

test("Pit: two independent pools split evenly, double winner takes both", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  const alice = "0xa11ce0000000000000000000000000000000000";
  const bob = "0xb0b0000000000000000000000000000000000000";
  store.getOrCreateUser(alice).arenaBalance = 5;
  store.getOrCreateUser(bob).arenaBalance = 5;

  const round = engine.schedulePitRound(pitConcept(store), Date.now());
  // Alice predicts Timer and trades; Bob only predicts Rug.
  enterPit(store, round, alice, { prediction: "timer", trading: true });
  enterPit(store, round, bob, { prediction: "rug" });

  // Fees skimmed 10%: prediction pot = 0.1*0.9*2, trading pot = 0.25*0.9.
  assert.ok(Math.abs(round.pit!.prediction.pot - 0.18) < 1e-9);
  assert.ok(Math.abs(round.pit!.trading.pot - 0.225) < 1e-9);

  // Simulate the match ending on the timer with Alice's stack in profit.
  round.state = "live";
  round.liveAt = Date.now() - 60_000;
  round.endReason = "timer";
  round.graduated = false;
  store.setPitStack(round.id, alice, 0.5); // spent 0.5 of the 1.0 stack
  store.position(round.id, alice).tokens = 0.8; // worth 0.8 at finalPrice 1.0
  // Standard needs >= 8 trades to qualify; give Alice enough.
  store.trades.set(
    round.id,
    Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      roundId: round.id,
      userAddress: alice,
      side: "buy" as const,
      ethAmount: 0.01,
      tokenAmount: 0.1,
      price: 1,
      fee: 0,
      at: Date.now(),
      isCreator: false,
    })),
  );

  const summary = resolvePitRound(store, round, {
    totalVolume: 1,
    peakMcap: 1,
    finalMcap: 1,
    finalPrice: 1,
    holderCount: 1,
    now: Date.now(),
  });
  const pit = summary.pit!;
  assert.equal(pit.outcome, "timer");
  assert.equal(pit.prediction.winners, 1); // only Alice called Timer
  assert.equal(pit.trading.qualified, 1); // Alice finished +0.3
  assert.ok(Math.abs(pit.prediction.rewardEach - 0.18) < 1e-9);
  assert.ok(Math.abs(pit.trading.rewardEach - 0.225) < 1e-9);

  const aliceRow = pit.players.find((p) => p.address === alice)!;
  assert.equal(aliceRow.doubleWinner, true);
  assert.ok(Math.abs(aliceRow.totalReward - 0.405) < 1e-9);
  const bobRow = pit.players.find((p) => p.address === bob)!;
  assert.equal(bobRow.predictionCorrect, false);
  assert.equal(bobRow.totalReward, 0);

  // Alice's lifetime Pit record reflects the double win.
  const ps = store.pitStatsOf(alice);
  assert.equal(ps.doubleWins, 1);
  assert.equal(ps.predictionWins, 1);
  assert.equal(ps.tradingWins, 1);
});

test("Pit: an unclaimed pool funds the weekly jackpot", () => {
  const store = new Store();
  const engine = new RoundEngine(store, () => {});
  const carol = "0xca401000000000000000000000000000000000000".slice(0, 42);
  store.getOrCreateUser(carol).arenaBalance = 5;
  const jackpotBefore = store.jackpotPool;
  const round = engine.schedulePitRound(pitConcept(store), Date.now());
  enterPit(store, round, carol, { prediction: "graduate" });
  round.state = "live";
  round.liveAt = Date.now() - 60_000;
  round.endReason = "timer"; // Carol predicted graduate — nobody is correct
  round.graduated = false;
  resolvePitRound(store, round, {
    totalVolume: 1,
    peakMcap: 1,
    finalMcap: 1,
    finalPrice: 1,
    holderCount: 0,
    now: Date.now(),
  });
  assert.ok(store.jackpotPool > jackpotBefore, "unclaimed prediction pool went to the jackpot");
  assert.equal(store.pitCarry.prediction, 0, "nothing carried to the next match");
});
