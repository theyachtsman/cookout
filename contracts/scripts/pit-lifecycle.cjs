/**
 * The Pit's prize pools, end to end on the real chain.
 *
 * Covers both endings that matter with real money: a resolved match paying
 * winners, and an unresolved one where entrants take their stakes back without
 * the operator's help. The second is the one worth proving — it is the only
 * thing standing between players and a stuck pot if the resolver ever goes
 * quiet, and it is the bound the whole oracle design leans on.
 */
const { ethers } = require("hardhat");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const E = (n) => ethers.parseEther(String(n));
const f = (w) => ethers.formatEther(w);
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, label, detail = "") => {
  log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};

async function main() {
  const d = JSON.parse(
    readFileSync(join(__dirname, "..", "deployments", "robinhoodTestnet.json"), "utf8"),
  );
  const [bank] = await ethers.getSigners();
  const provider = ethers.provider;
  log(`bank ${bank.address} (${f(await provider.getBalance(bank.address))} ETH)`);
  log(`pit factory ${d.pitPoolFactory}`);

  const factory = await ethers.getContractAt("PitPoolFactory", d.pitPoolFactory, bank);
  check((await factory.resolver()).toLowerCase() === bank.address.toLowerCase(),
    "the API's operator key is the resolver");

  // Two players, reused across runs so leftover gas is not stranded.
  const players = [0, 1].map((i) =>
    new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`pit-live-${i}`)), provider));
  for (const w of players) {
    const bal = await provider.getBalance(w.address);
    if (bal < E(0.004)) {
      await (await bank.sendTransaction({ to: w.address, value: E(0.004) - bal })).wait();
    }
  }
  log(`players funded: ${players.map((p) => p.address.slice(0, 10)).join(", ")}`);

  const ENTRY = E(0.0005);
  const now = () => Math.floor(Date.now() / 1000);

  // ---------- 1. a match that resolves ----------
  log(`\n1. create pools for a match that will resolve`);
  const id1 = ethers.id(`pit-live-resolve-${Date.now()}`);
  const close1 = now() + 90;
  await (await factory.createPools(id1, 500, 500, ENTRY, close1, close1 + 86_400)).wait();
  const p1 = await factory.poolsFor(id1);
  const pred = await ethers.getContractAt("PitPool", p1.prediction, bank);
  const battle = await ethers.getContractAt("PitBattlePool", p1.battle, bank);
  log(`   prediction ${p1.prediction}`);
  log(`   battle     ${p1.battle}`);
  check((await battle.entryFee()) === ENTRY, "battle entry is the tier price", f(ENTRY));

  log(`\n2. players stake`);
  const GRADUATE = 1, RUG = 2;
  await (await pred.connect(players[0]).stake(GRADUATE, { value: E(0.001) })).wait();
  await (await pred.connect(players[1]).stake(RUG, { value: E(0.0005) })).wait();
  await (await battle.connect(players[0]).enter({ value: ENTRY })).wait();
  await (await battle.connect(players[1]).enter({ value: ENTRY })).wait();
  check((await pred.totalStaked()) === E(0.0015), "prediction escrow holds both stakes");
  check((await battle.entrants()) === 2n, "both entered the battle");
  await expect_(
    battle.connect(players[1]).enter({ value: ENTRY }),
    "a second entry from the same player is refused",
  );

  log(`\n3. wait for close, then resolve as the operator would`);
  while (now() < close1 + 2) await sleep(3000);
  await (await pred.resolve(GRADUATE)).wait();
  await (await battle.resolve(players[0].address)).wait();
  check(await pred.resolved(), "prediction resolved");
  check((await battle.winner()).toLowerCase() === players[0].address.toLowerCase(),
    "battle winner is the named entrant");

  log(`\n4. winners claim, losers get nothing`);
  const predOwed = await pred.pending(players[0].address);
  const battleOwed = await battle.pending(players[0].address);
  log(`   player0 owed: ${f(predOwed)} (prediction) + ${f(battleOwed)} (battle)`);
  check(predOwed > 0n && battleOwed > 0n, "the winner is owed both pots");
  check((await pred.pending(players[1].address)) === 0n, "the wrong call is owed nothing");

  const before = await provider.getBalance(players[0].address);
  const c1 = await (await pred.connect(players[0]).claim()).wait();
  const c2 = await (await battle.connect(players[0]).claim()).wait();
  const gas = c1.gasUsed * c1.gasPrice + c2.gasUsed * c2.gasPrice;
  const got = (await provider.getBalance(players[0].address)) - before + gas;
  check(got === predOwed + battleOwed, "paid exactly what was owed", f(got));
  await expect_(pred.connect(players[0]).claim(), "claiming twice is refused");

  // ---------- 2. a match nobody resolves ----------
  log(`\n5. a match the operator never resolves`);
  // A refund window in the past, so the escape hatch can be exercised now
  // rather than a day from now. The contract only requires it to be after
  // close, which is the invariant that matters.
  const id2 = ethers.id(`pit-live-abandon-${Date.now()}`);
  const close2 = now() + 30;
  await (await factory.createPools(id2, 500, 500, ENTRY, close2, close2 + 20)).wait();
  const p2 = await factory.poolsFor(id2);
  const pred2 = await ethers.getContractAt("PitPool", p2.prediction, bank);
  await (await pred2.connect(players[1]).stake(RUG, { value: E(0.0008) })).wait();

  log(`   waiting out the window (no resolve call is ever made)`);
  while (now() < close2 + 22) await sleep(3000);
  // Permissionless: a player opens it, not the operator.
  await (await pred2.connect(players[1]).openRefunds()).wait();
  check(await pred2.refunding(), "anyone can open refunds once the window passes");

  const b2 = await provider.getBalance(players[1].address);
  const r2 = await (await pred2.connect(players[1]).refund()).wait();
  const back = (await provider.getBalance(players[1].address)) - b2 + r2.gasUsed * r2.gasPrice;
  check(back === E(0.0008), "stake returned in full, fee-free", f(back));
  check((await provider.getBalance(p2.prediction)) === 0n, "pool drained to zero");

  log(`\n6. sweep leftover gas home`);
  for (const w of players) {
    const bal = await provider.getBalance(w.address);
    const g = (await provider.getFeeData()).gasPrice * 300_000n;
    if (bal > g) await (await w.sendTransaction({ to: bank.address, value: bal - g })).wait();
  }
  log(`   bank ${f(await provider.getBalance(bank.address))} ETH`);

  log(`\n${bad === 0 ? "ALL CHECKS PASSED" : `${bad} CHECK(S) FAILED`}`);
  if (bad) process.exit(1);
}

/** Assert a call reverts, without pulling in chai. */
async function expect_(promise, label) {
  try {
    await (await promise).wait();
    check(false, label, "it did NOT revert");
  } catch {
    check(true, label);
  }
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
