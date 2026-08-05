/**
 * The other ending: a round that misses its graduation criteria.
 *
 * Round #1 of the multi-wallet run fell short on market cap and resolved to
 * Redeem, which is the outcome most coins will actually have. This checks the
 * part that matters there — that every holder exits at the same uniform price,
 * with no advantage to going first — and sweeps leftover gas home.
 */
const { ethers } = require("hardhat");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const E = (n) => ethers.parseEther(String(n));
const f = (w) => ethers.formatEther(w);
const log = (...a) => console.log(...a);
let failures = 0;
const check = (ok, label, detail = "") => {
  log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const d = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "robinhoodTestnet.json")));
  const [bank] = await ethers.getSigners();
  const provider = ethers.provider;
  const traders = [];
  for (let i = 0; i < 4; i++)
    traders.push(new ethers.Wallet(
      ethers.keccak256(ethers.toUtf8Bytes(`cookout-multiwallet-v1-${i}`)), provider));

  const factory = await ethers.getContractAt(
    (await ethers.getContractFactory("RoundFactory", { libraries: { PriceMath: d.priceMath } }))
      .interface.fragments, d.roundFactory, bank);

  const target = BigInt(process.env.ROUND ?? "1");
  const r = await factory.rounds(target);
  const pool = await ethers.getContractAt("RoundPool", r.pool, bank);
  const token = await ethers.getContractAt("ArenaToken", r.token, bank);
  const phase = await pool.phase();
  log(`round #${target} pool ${r.pool} phase ${phase} (3 = Redeem)`);
  check(phase === 3n, "a round that missed its criteria is in Redeem, not Graduated");
  if (phase !== 3n) { log("nothing to redeem"); return; }

  const price = await pool.redemptionPriceWad();
  log(`redemption price ${price} wei per 1e18 tokens`);

  log(`\nredeem, in a deliberately awkward order`);
  const paid = [];
  for (const i of [2, 0, 3, 1]) {
    const w = traders[i];
    const bal = await token.balanceOf(w.address);
    if (bal === 0n) { log(`   trader${i}: no tokens`); continue; }
    const before = await provider.getBalance(w.address);
    const ap = await (await token.connect(w).approve(r.pool, bal)).wait();
    const rd = await (await pool.connect(w).redeem(bal)).wait();
    const gas = ap.gasUsed * ap.gasPrice + rd.gasUsed * rd.gasPrice;
    const out = (await provider.getBalance(w.address)) - before + gas;
    const unit = (out * 10n ** 18n) / bal;
    paid.push({ i, unit, out, bal });
    log(`   trader${i}: ${f(bal)} tokens -> ${f(out)} ETH (${unit} per 1e18)`);
  }

  if (paid.length > 1) {
    const units = paid.map((p) => p.unit);
    const spread = units.reduce((a, b) => (a > b ? a : b)) - units.reduce((a, b) => (a < b ? a : b));
    // The whole promise of uniform redemption: exiting first buys you nothing.
    check(spread === 0n, "everyone exited at exactly the same price", `spread ${spread} wei`);
    // Never ABOVE the published price — that would mean the pool paid out more
    // than it priced, which is the direction that drains it. A wei below is
    // just integer division flooring, twice: once in the contract computing
    // ethOut, once here dividing back out to a unit price.
    check(units.every((u) => u <= price && price - u <= 1n),
      "and at the published price, to within the rounding",
      `published ${price}, effective ${units[0]}`);
  }

  const dust = await provider.getBalance(r.pool);
  log(`\npool retains ${f(dust)} ETH (unredeemed tokens + accrued fees)`);

  log(`\nsweep leftover gas back to the bank`);
  for (const w of traders) {
    const bal = await provider.getBalance(w.address);
    const gas = (await provider.getFeeData()).gasPrice * 300_000n;
    if (bal > gas) await (await w.sendTransaction({ to: bank.address, value: bal - gas })).wait();
  }
  log(`bank now ${f(await provider.getBalance(bank.address))} ETH`);
  log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
