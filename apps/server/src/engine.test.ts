import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, unlockedCosmetics, weekKey, type ServerEvent, type TokenConcept } from "@cookout/shared";
import { RoundEngine } from "./engine.js";
import { nextFreeSlot } from "./seed.js";
import { Store } from "./store.js";

function setup() {
  const store = new Store();
  const events: ServerEvent[] = [];
  // System banners are posted through the `sys` hook (index.ts wires it to the
  // chat room); record them so tests can assert on the ones that matter.
  const sys: { room: string; kind: string; text: string }[] = [];
  const engine = new RoundEngine(
    store,
    (_roundId, e) => events.push(e),
    () => 0,
    (room, kind, text) => sys.push({ room, kind, text }),
  );
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
  return { store, engine, events, sys, concept };
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

  // Rookie keeps its training wheels on after the open: a buy that would push
  // the live position past liveMaxPositionEth is refused (higher tiers uncapped).
  assert.throws(
    () => engine.trade(round.id, B, "buy", { eth: round.config.liveMaxPositionEth + 0.5 }, now + 2000),
    /live position/,
  );

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

test("1-minute blitz: dev can rug the whole bag penalty-free, no sell lock", () => {
  const { store, engine, concept } = setup();
  concept.matchMinutes = 1;
  const t0 = 2_700_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  assert.equal(round.blitz, true, "1-min rounds are blitz");
  assert.equal(round.config.devSellLockSeconds, 0, "blitz drops the dev sell lock");
  round.config.maxPositionEth = 0;
  round.config.curveAnchorEth = 50;
  round.config.graduationMcap = 1e9;
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.getOrCreateUser(concept.creatorAddress).arenaBalance = 100;
  store.getOrCreateUser(A).arenaBalance = 100;
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.3, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);
  // Dev dumps the entire bag the instant it's live — allowed, and it rugs.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 100 }, round.liveAt! + 500);
  assert.equal(round.endReason, "rug_detected");
  const cr = store.getOrCreateUser(concept.creatorAddress);
  assert.equal(cr.creatorReputation, 0, "blitz rug costs no reputation");
  assert.ok(!cr.rugBans || cr.rugBans.length === 0, "blitz rug issues no launch ban");
});

test("dev rug: a trim under 75% is safe; crossing 75% cumulative pulls the coin", () => {
  const { store, engine, concept } = setup();
  const t0 = 2_500_000_000;
  const round = engine.scheduleRound(concept, "degen", t0);
  round.config.maxPositionEth = 0;
  // Deep pool + no graduation so the ONLY rug path is the dev dump.
  round.config.curveAnchorEth = 50;
  round.config.graduationMcap = 1e9;
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.getOrCreateUser(concept.creatorAddress).arenaBalance = 100;
  store.getOrCreateUser(A).arenaBalance = 100;
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.3, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);

  // Creator trims half their bag — profit-taking, not a rug.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 50 }, round.liveAt! + 1000);
  assert.equal(round.state, "live", "a 50% trim does not rug");
  // A second sell pushes cumulative sold past 75% of their peak → rug.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 60 }, round.liveAt! + 2000);
  assert.equal(round.state, "results");
  assert.equal(round.endReason, "rug_detected");
});

test("graduation: criteria met migrates instead of redeeming", () => {
  const { store, engine, concept } = setup();
  const t0 = 3_000_000_000;
  const round = engine.scheduleRound(concept, "rookie", t0);
  round.config.maxPositionEth = 0;
  round.config.liveMaxPositionEth = 0; // uncapped: this test drives graduation, not the cap
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
  const spot = round.config.curveAnchorEth / round.config.initialTokenLiquidity;
  engine.submitIntent(round.id, A, 0.2, spot * 1.000001, round.queueOpensAt! + 1); // too tight
  engine.submitIntent(round.id, B, 0.25, undefined, round.queueOpensAt! + 2);
  assert.ok(Math.abs((a.arenaBalance ?? 0) - 9.8) < 1e-9);
  engine.tick(round.queueClosesAt!);
  assert.ok(Math.abs((a.arenaBalance ?? 0) - 10) < 1e-9, "excluded limit intent fully refunded");
  assert.equal(store.position(round.id, A).tokens, 0);
  assert.ok(store.position(round.id, B).tokens > 0);
});

test("Endurance: no clock, no low-volume cutoff — it runs until it bonds", () => {
  const { store, engine, concept } = setup();
  const t0 = 7_000_000_000;
  concept.mode = "endurance";
  concept.modifiers = { overtime: true }; // must be dropped: no clock to extend
  const round = engine.scheduleRound(concept, "standard", t0);
  assert.equal(round.modifiers, undefined, "Endurance takes no modifiers");
  assert.equal(round.config.overtime, false);
  assert.equal(round.config.mcapTarget, 0, "no early mcap ending");

  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, A, 0.2, undefined, round.queueOpensAt! + 1);
  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");
  assert.equal(round.endsAt, undefined, "an Endurance round has no end time");

  // Way past any normal match length, and dead quiet the whole way: a timed
  // round would have ended on the timer or on low volume. This one is still on.
  let now = round.liveAt! + 1000;
  for (let i = 0; i < 60; i++) {
    now += 60_000;
    engine.tick(now);
  }
  assert.equal(round.state, "live", "still trading an hour later with zero volume");

  // The one ending that does apply: completing the bonding curve.
  engine.endRound(round, "graduated", now + 1000);
  assert.equal(round.state, "results");
  assert.equal(round.graduated, true);
});

test("Endurance never blocks the timed match calendar", () => {
  const { store, engine, concept } = setup();
  const t0 = 8_000_000_000;
  concept.mode = "endurance";
  const endless = engine.scheduleRound(concept, "standard", t0);
  engine.tick(t0);
  engine.tick(endless.queueOpensAt!);
  store.arenaDeposit(A, 10);
  engine.submitIntent(endless.id, A, 0.2, undefined, endless.queueOpensAt! + 1);
  engine.tick(endless.queueClosesAt!);
  assert.equal(endless.state, "live");

  // A live Endurance round has no endsAt, so a slot search that counted it
  // would push every timed match out forever. It must be ignored instead.
  const slot = nextFreeSlot(store, 30_000, t0 + 10_000);
  assert.ok(slot <= t0 + 40_000, `slot should ignore the endless round, got ${slot - t0}ms after t0`);
});

test("Endurance: the dev can dump freely — no rug, no ban, just a named alert", () => {
  const { store, engine, sys, concept } = setup();
  const t0 = 9_000_000_000;
  concept.mode = "endurance";
  const dev = store.getOrCreateUser(concept.creatorAddress);
  dev.displayName = "hood_chef";
  dev.avatarUrl = "data:image/png;base64,ZmFrZQ==";
  const round = engine.scheduleRound(concept, "standard", t0);
  assert.equal(round.config.rugRules, false, "Endurance has no rug mechanics");
  assert.equal(round.config.devSellLockSeconds, 0, "and no dev sell lock");

  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  // The dev fair-enters through the same queue as everyone else.
  store.arenaDeposit(concept.creatorAddress, 10);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.3, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);
  assert.equal(round.state, "live");

  // The dev dumps their whole bag the instant it opens. In a rug-rules mode
  // that ends the round as a rug; here it's just a sell.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 100 }, round.liveAt! + 1000);
  assert.equal(round.state, "live", "a dev dump doesn't end an Endurance round");
  assert.equal(round.endReason, undefined);
  assert.equal(store.getOrCreateUser(concept.creatorAddress).rugBans ?? undefined, undefined);

  // …but it is announced, by name and with their picture, and says how much.
  const feed = store.killfeed.get(round.id) ?? [];
  const devSell = feed.filter((e) => e.kind === "dev_sell");
  assert.equal(devSell.length, 1, "the sell is called out");
  const alert = devSell[0]!;
  assert.match(alert.text, /hood_chef/, "the dev is named");
  assert.match(alert.text, /ENTIRE BAG/, "a full exit says so plainly");
  assert.equal(alert.actor?.address, concept.creatorAddress);
  assert.equal(alert.actor?.displayName, "hood_chef");
  assert.equal(alert.actor?.avatarUrl, dev.avatarUrl, "the alert carries their picture");
  assert.equal(alert.actor?.isCreator, true);

  // And it breaks into the match chat so the room can't miss it.
  assert.ok(
    sys.some((m) => m.room === round.id && m.kind === "dev_sell" && /hood_chef/.test(m.text)),
    "the dev sell posts a system banner in chat",
  );
});

test("timed modes still rug on a dev dump", () => {
  const { store, engine, concept } = setup();
  const t0 = 10_000_000_000;
  concept.mode = "classic";
  const round = engine.scheduleRound(concept, "standard", t0);
  assert.notEqual(round.config.rugRules, false);
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(concept.creatorAddress, 10);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.3, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);

  engine.trade(
    round.id,
    concept.creatorAddress,
    "sell",
    { pct: 100 },
    round.liveAt! + round.config.devSellLockSeconds * 1000 + 1000,
  );
  assert.equal(round.endReason, "rug_detected", "the dev-dump auto-rug still applies elsewhere");
});

test("Endurance progression: quests, achievements, titles and badges", () => {
  const { store, engine, concept } = setup();
  const t0 = 11_000_000_000;
  concept.mode = "endurance";
  const round = engine.scheduleRound(concept, "standard", t0);
  engine.tick(t0);
  engine.tick(round.queueOpensAt!);
  store.arenaDeposit(concept.creatorAddress, 10);
  store.arenaDeposit(A, 10);
  engine.submitIntent(round.id, concept.creatorAddress, 0.3, undefined, round.queueOpensAt! + 1);
  engine.submitIntent(round.id, A, 0.5, undefined, round.queueOpensAt! + 2);
  engine.tick(round.queueClosesAt!);

  // The dev bails early; A holds on for two days and rides it to the bond.
  engine.trade(round.id, concept.creatorAddress, "sell", { pct: 100 }, round.liveAt! + 60_000);
  const end = round.liveAt! + 48 * 3_600_000;
  engine.endRound(round, "graduated", end, true);

  const a = store.getOrCreateUser(A);
  assert.equal(a.stats.enduranceRounds, 1);
  assert.equal(a.stats.enduranceBonds, 1);
  assert.ok(a.stats.longestEnduranceHoldSeconds! >= 47 * 3600, "records the real hold time");

  // Achievements: the Endurance ladder, held-to-bond, and conviction.
  for (const id of ["endurance_initiate", "long_hauler", "marathon_runner", "went_the_distance", "unshaken"])
    assert.ok(a.achievements.includes(id), `A unlocked ${id}`);

  // Quest metrics feed the daily/weekly Endurance missions.
  const daily = a.activity[dayKey(end)] ?? {};
  const weekly = a.activity[weekKey(end)] ?? {};
  for (const metric of ["endurance_played", "endurance_profit", "endurance_long_holds", "endurance_bonds"] as const) {
    assert.ok((daily[metric] ?? 0) >= 1, `${metric} tracked for the daily Endurance quests`);
    assert.ok((weekly[metric] ?? 0) >= 1, `${metric} tracked for the weekly Endurance quests`);
  }

  // Titles and badges are unlocked by those achievements.
  const unlocked = unlockedCosmetics({ level: a.level, achievements: a.achievements }).map((c) => c.id);
  for (const id of ["b_endurance", "b_longhaul", "b_marathon", "b_unshaken", "t_longhauler", "t_marathoner", "t_distance", "t_unshaken"])
    assert.ok(unlocked.includes(id), `cosmetic ${id} unlocked`);

  // The creator who took a no-timer launch all the way gets the legendary.
  const dev = store.getOrCreateUser(concept.creatorAddress);
  assert.ok(dev.achievements.includes("endurance_launcher"), "Built to Last");
  assert.ok(
    unlockedCosmetics({ level: dev.level, achievements: dev.achievements })
      .map((c) => c.id)
      .includes("t_builder"),
  );
});
