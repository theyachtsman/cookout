import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerEvent, TokenConcept } from "@cookout/shared";
import { RoundEngine } from "./engine.js";
import { Store } from "./store.js";

function setup() {
  const store = new Store();
  const events: ServerEvent[] = [];
  const engine = new RoundEngine(store, (_roundId, e) => events.push(e));
  const creator = store.getOrCreateUser("0x00000000000000000000000000000000000000c1");
  const concept: TokenConcept = {
    id: store.id(),
    creatorAddress: creator.address,
    name: "Block Party",
    symbol: "BLOCK",
    theme: "test",
    status: "shortlisted",
    votes: 5,
    createdAt: 0,
  };
  store.concepts.set(concept.id, concept);
  return { store, engine, events, concept };
}

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

test("full round: lobby → queue → uniform settle → trades → timer end → XP", () => {
  const { store, engine, events, concept } = setup();
  const t0 = 1_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  assert.equal(round.state, "scheduled");

  engine.tick(t0);
  assert.equal(round.state, "lobby");
  engine.tick(round.queueOpensAt!);
  assert.equal(round.state, "queue_open");

  // Matches spend the arena balance, so stake the bank first — same as a
  // player depositing before they pull up.
  const a = store.arenaDeposit(A, 10);
  const b = store.arenaDeposit(B, 10);
  engine.submitIntent(round.id, A, 0.2, undefined, round.queueOpensAt! + 1000);
  engine.submitIntent(round.id, B, 0.1, undefined, round.queueOpensAt! + 2000);
  // The position cap constrains the fair-open queue: nobody pre-loads the bond.
  assert.throws(
    () => engine.submitIntent(round.id, B, round.config.maxPositionEth, undefined, round.queueOpensAt! + 3000),
    /position cap/,
  );
  assert.ok(Math.abs((a.arenaBalance ?? 0) - 9.8) < 1e-9, "intent escrows arena balance");
  assert.ok(Math.abs((b.arenaBalance ?? 0) - 9.9) < 1e-9);
  assert.equal(a.paperBalance, 0, "the bank is untouched by the match");

  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");
  assert.ok(round.clearingPrice! > 0);
  const auction = store.auctionResults.get(round.id)!;
  assert.equal(auction.fillRatio, 1);
  assert.ok(auction.auditHash.length === 64);
  const posA = store.position(round.id, A);
  const posB = store.position(round.id, B);
  // Uniform price: tokens proportional to ETH committed.
  assert.ok(Math.abs(posA.tokens / posB.tokens - 2) < 1e-9);

  // Continuous trading.
  const now = round.liveAt! + 5000;
  const buyTrade = engine.trade(round.id, B, "buy", { eth: 0.15 }, now);
  assert.equal(buyTrade.side, "buy");
  const sellTrade = engine.trade(round.id, A, "sell", { pct: 50 }, now + 1000);
  assert.ok(sellTrade.ethAmount > 0);
  assert.ok(events.some((e) => e.type === "trade"));

  // Live trading is uncapped — an over-cap buy is fine once the round is open.
  const bigBuy = engine.trade(
    round.id,
    B,
    "buy",
    { eth: round.config.maxPositionEth + 0.5 },
    now + 2000,
  );
  assert.equal(bigBuy.side, "buy");

  // Timer expiry ends the round and resolves everyone at one redemption price.
  engine.tick(round.endsAt!);
  assert.equal(round.state, "results");
  assert.equal(round.endReason, "timer");
  const summary = store.summaries.get(round.id)!;
  assert.ok(summary.winner);
  assert.ok(summary.totalVolume > 0);
  assert.equal(store.position(round.id, A).tokens, 0, "non-graduated round fully redeems");
  assert.ok(a.xp > 0, "participation XP awarded");
  assert.ok(a.stats.roundsPlayed === 1);
  // Paper money conservation-ish: balances are back to cash, nobody minted value.
  const total = (a.arenaBalance ?? 0) + (b.arenaBalance ?? 0);
  assert.ok(total < 20, "players in aggregate paid fees + auction premium into the pool");
});

test("creator-chosen matchMinutes drives the live-trading clock", () => {
  const { store, engine, concept } = setup();
  concept.matchMinutes = 5; // rookie default is 10 min — the pick must win
  const t0 = 1_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  assert.equal(round.config.maxDurationSeconds, 300);

  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, A, 0.2, undefined, round.queueOpensAt! + 1000);
  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");
  // The market closes exactly matchMinutes after going live. (No tick-to-end
  // here: a 5-minute silent fast-forward would trip the low-volume auto-end,
  // which is its own feature — the clock itself is what this test pins.)
  assert.equal(round.endsAt! - round.liveAt!, 5 * 60_000);
});

test("rug detection: creator dump drains pool and ends the round", () => {
  const { store, engine, concept } = setup();
  const t0 = 2_000_000_000;
  const round = engine.scheduleRound(concept, "degen", t0);
  round.config.maxPositionEth = 0; // uncapped for the test
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  const creator = store.getOrCreateUser(concept.creatorAddress);
  creator.arenaBalance = 100;
  store.getOrCreateUser(A).arenaBalance = 100;
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.05, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");

  const m = engine.meta(round.id, A);
  // A exits most of their bag before the dump.
  engine.trade(round.id, A, "sell", { pct: 60 }, round.liveAt! + 1000);
  // Creator dumps everything → dev-dump rug trigger.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 100 }, round.liveAt! + 2000);
  assert.equal(round.state, "results");
  assert.equal(round.endReason, "rug_detected");
  assert.ok(m.tokensSoldBeforeEnd > 0);
  const killfeed = store.killfeed.get(round.id)!;
  assert.ok(killfeed.some((k) => k.kind === "rug_detected"));
  const a = store.getOrCreateUser(A);
  assert.ok(a.achievements.includes("rug_survivor"), "sold ≥50% before the rug");
  const cr = store.getOrCreateUser(concept.creatorAddress);
  assert.ok(cr.creatorReputation < 0, "rugging tanks creator reputation");
});

test("graduation: criteria met migrates instead of redeeming", () => {
  const { store, engine, concept } = setup();
  const t0 = 3_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  round.config.maxPositionEth = 0;
  round.config.graduationMcap = 20;
  round.config.graduationMinHolders = 2;
  round.config.graduationMinVolume = 1;
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.getOrCreateUser(A).arenaBalance = 100;
  store.getOrCreateUser(B).arenaBalance = 100;
  engine.submitIntent(round.id, A, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, B, 0.3, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);
  engine.trade(round.id, A, "buy", { eth: 8 }, round.liveAt! + 1000);
  engine.tick(round.endsAt!);
  assert.equal(round.state, "results");
  assert.equal(round.graduated, true);
  assert.ok(store.position(round.id, A).tokens > 0, "graduates keep their tokens");
  assert.equal(store.concepts.get(concept.id)!.status, "launched");
  const a = store.getOrCreateUser(A);
  assert.ok(a.achievements.includes("moon_rider"));
  const cr = store.getOrCreateUser(concept.creatorAddress);
  assert.ok(cr.achievements.includes("graduate_launcher"));
  assert.ok(cr.creatorReputation >= 2);
});

test("low-volume trigger ends a quiet round", () => {
  const { store, engine, concept } = setup();
  const t0 = 4_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, A, 0.1, undefined, round.queueOpensAt! + 1);
  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");
  engine.tick(round.liveAt! + (round.config.lowVolumeWindowSeconds + 2) * 1000);
  assert.equal(round.state, "results");
  assert.equal(round.endReason, "low_volume");
  assert.ok(store.summaries.has(round.id));
});

test("pause blocks trading, extends the clock, and admin liquidity pull ends round", () => {
  const { store, engine, concept } = setup();
  const t0 = 5_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, A, 0.2, undefined, round.queueOpensAt! + 1);
  engine.tick(round.queueClosesAt!);

  const endsBefore = round.endsAt!;
  engine.setPaused(round.id, true, round.liveAt! + 1000);
  assert.throws(
    () => engine.trade(round.id, A, "sell", { pct: 100 }, round.liveAt! + 2000),
    /paused/,
  );
  engine.setPaused(round.id, false, round.liveAt! + 11_000);
  assert.equal(round.endsAt, endsBefore + 10_000, "pause extends the round clock");

  engine.simulateLiquidityPull(round.id, round.liveAt! + 12_000);
  assert.equal(round.endReason, "liquidity_removed");
  assert.equal(round.state, "results");
});

test("limit intents below clearing are refunded in full at settlement", () => {
  const { store, engine, concept } = setup();
  const t0 = 6_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  const a = store.arenaDeposit(A, 10);
  store.arenaDeposit(B, 10);
  const spot = round.config.initialEthLiquidity / round.config.initialTokenLiquidity;
  engine.submitIntent(round.id, A, 0.2, spot * 1.000001, round.queueOpensAt! + 1); // too tight
  engine.submitIntent(round.id, B, 0.25, undefined, round.queueOpensAt! + 2);
  assert.ok(Math.abs((a.arenaBalance ?? 0) - 9.8) < 1e-9);
  engine.tick(round.queueClosesAt!);
  assert.ok(Math.abs((a.arenaBalance ?? 0) - 10) < 1e-9, "excluded limit intent fully refunded");
  assert.equal(store.position(round.id, A).tokens, 0);
  assert.ok(store.position(round.id, B).tokens > 0);
});
