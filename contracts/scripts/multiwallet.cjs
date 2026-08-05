/**
 * A round with real graduation thresholds and four independent traders.
 *
 * The earlier lifecycle run proved the mechanism with one wallet and thresholds
 * set to zero. This proves the economics: an oversubscribed auction that has to
 * fill pro-rata, a uniform clearing price nobody can beat by bidding first, a
 * limit order that gets excluded, graduation criteria that actually have to be
 * met, and escrow that stays solvent through every claim.
 */
const { ethers } = require("hardhat");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const E = (n) => ethers.parseEther(String(n));
const f = (w) => ethers.formatEther(w);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let failures = 0;
function check(ok, label, detail = "") {
  log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const d = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "robinhoodTestnet.json")));
  const [bank] = await ethers.getSigners();
  const provider = ethers.provider;

  // Four traders, derived so a rerun reuses the same accounts (and whatever
  // gas they have left) instead of stranding funds in fresh ones.
  const traders = [];
  for (let i = 0; i < 4; i++) {
    const w = new ethers.Wallet(
      ethers.keccak256(ethers.toUtf8Bytes(`cookout-multiwallet-v1-${i}`)),
      provider,
    );
    traders.push(w);
  }
  log(`bank ${bank.address} (${f(await provider.getBalance(bank.address))} ETH)`);

  log(`\n0. fund the traders`);
  for (const [i, w] of traders.entries()) {
    const bal = await provider.getBalance(w.address);
    const want = E(0.01);
    if (bal < want) {
      await (await bank.sendTransaction({ to: w.address, value: want - bal })).wait();
    }
    log(`   trader${i} ${w.address} ${f(await provider.getBalance(w.address))} ETH`);
  }

  const factory = await ethers.getContractAt(
    (await ethers.getContractFactory("RoundFactory", { libraries: { PriceMath: d.priceMath } }))
      .interface.fragments,
    d.roundFactory,
    bank,
  );

  // Real thresholds this time. The auction cap is deliberately below what the
  // traders will bid, so the fill has to be pro-rata rather than first-come.
  const now = (await provider.getBlock("latest")).timestamp;
  const MAX_RAISE = E(0.004);
  log(`\n1. createRound — maxRaise ${f(MAX_RAISE)} ETH, real graduation criteria`);
  const rc = await (
    await factory.createRound(
      {
        name: "Crowd Test", symbol: "CROWD", totalSupply: E(1_000_000),
        queueClosesAt: now + 90, endTime: now + 200,
        auctionMaxRaiseWei: MAX_RAISE, auctionFeeBps: 100, tradeFeeBps: 100,
        mcapTargetWei: 0,
        graduationMcapWei: E(0.05),
        graduationMinVolumeWei: E(0.008),
        graduationMinHolders: 4,
        feeRecipient: bank.address, creator: bank.address,
        feeDestination: ethers.ZeroAddress,
      },
      { value: E(0.02) },
    )
  ).wait();
  const id = (await factory.roundCount()) - 1n;
  const r = await factory.rounds(id);
  log(`   round #${id} pool ${r.pool} locker ${r.locker}`);

  const pool = await ethers.getContractAt("RoundPool", r.pool, bank);
  const auction = await ethers.getContractAt("BatchAuction", r.auction, bank);
  const token = await ethers.getContractAt("ArenaToken", r.token, bank);
  const locker = await ethers.getContractAt("CookoutLpLocker", r.locker, bank);

  log(`\n2. four traders pull up — 0.006 ETH of demand against a 0.004 cap`);
  const spot = (await pool.getReserves())[0] * (10n ** 18n) / (await pool.getReserves())[1];
  const bids = [
    { i: 0, amount: E(0.002), max: 0n, note: "market" },
    { i: 1, amount: E(0.002), max: 0n, note: "market" },
    { i: 2, amount: E(0.001), max: spot * 100n, note: "limit, far above clearing" },
    { i: 3, amount: E(0.001), max: 1n, note: "limit at 1 wei — must be excluded" },
  ];
  for (const b of bids) {
    await (await auction.connect(traders[b.i]).submit(b.max, { value: b.amount })).wait();
    log(`   trader${b.i} ${f(b.amount)} ETH (${b.note})`);
  }
  const escrow = await provider.getBalance(r.auction);
  check(escrow === E(0.006), "escrow holds every bid", `${f(escrow)} ETH`);

  log(`\n3. settle`);
  while ((await provider.getBlock("latest")).timestamp < now + 91) await sleep(3000);
  const st = await (await auction.settle()).wait();
  const clearing = await auction.clearingPriceWad();
  const raised = await auction.totalRaisedWei();
  log(`   gas ${st.gasUsed}, clearing ${clearing}, raised ${f(raised)} ETH`);
  check(raised <= MAX_RAISE, "raise respects the cap", `${f(raised)} <= ${f(MAX_RAISE)}`);

  log(`\n4. claim — uniform price, pro-rata fill, refunds for the rest`);
  const fills = [];
  for (const b of bids) {
    const before = await provider.getBalance(traders[b.i].address);
    const cl = await (await auction.connect(traders[b.i]).claim(BigInt(b.i))).wait();
    const spent = cl.gasUsed * cl.gasPrice;
    const after = await provider.getBalance(traders[b.i].address);
    const refund = after - before + spent;
    const got = await token.balanceOf(traders[b.i].address);
    const filled = b.amount - refund;
    fills.push({ ...b, filled, refund, got });
    const price = got > 0n ? (filled * 10n ** 18n) / got : 0n;
    log(`   trader${b.i}: filled ${f(filled)} refund ${f(refund)} tokens ${f(got)} price ${price}`);
  }

  const priced = fills.filter((x) => x.got > 0n);
  const prices = priced.map((x) => (x.filled * 10n ** 18n) / x.got);
  const spread = prices.length ? prices.reduce((a, b) => (a > b ? a : b)) - prices.reduce((a, b) => (a < b ? a : b)) : 0n;
  check(spread * 10n ** 6n <= prices[0], "every fill paid the same price", `spread ${spread} wei/token`);

  const excluded = fills.find((x) => x.i === 3);
  check(excluded.got === 0n && excluded.refund === excluded.amount,
    "the 1-wei limit was excluded and fully refunded");

  // Pro-rata: the two equal market bids must fill equally, and the smaller
  // eligible bid proportionally less. Nobody's position depends on order.
  const [t0, t1, t2] = [fills[0], fills[1], fills[2]];
  check(t0.filled === t1.filled, "equal bids filled equally", `${f(t0.filled)} vs ${f(t1.filled)}`);
  const ratio = t0.filled > 0n ? (t2.filled * 1000n) / t0.filled : 0n;
  check(ratio >= 480n && ratio <= 520n, "a half-size bid filled about half", `${Number(ratio) / 10}%`);

  const leftover = await provider.getBalance(r.auction);
  check(leftover === 0n, "escrow fully drained — every wei accounted for", `${leftover} wei`);

  log(`\n5. trade until the graduation criteria are actually met`);
  const supply = await token.totalSupply();
  const mcapNow = async () => {
    const [e, t] = await pool.getReserves();
    return (e * supply) / t;
  };
  // Buy in rounds until mcap clears, rather than guessing an amount: the curve
  // is convex, so a fixed number is either short or wasteful.
  for (let pass = 0; pass < 6 && (await mcapNow()) < E(0.05); pass++) {
    for (const w of traders) {
      if ((await mcapNow()) >= E(0.05)) break;
      if ((await provider.getBalance(w.address)) < E(0.002)) continue;
      await (await pool.connect(w).buy(0, { value: E(0.0012) })).wait();
    }
  }
  const [er, tr] = await pool.getReserves();
  const mcap = (er * supply) / tr;
  log(`   mcap ${f(mcap)} ETH, volume ${f(await pool.cumulativeVolumeWei())} ETH, holders ${await token.holderCount()}`);
  check(mcap >= E(0.05), "mcap criterion met");
  check((await pool.cumulativeVolumeWei()) >= E(0.008), "volume criterion met");
  check((await token.holderCount()) >= 4n, "holder criterion met with real balances");

  log(`\n6. resolve and graduate`);
  while ((await provider.getBlock("latest")).timestamp < now + 201) await sleep(3000);
  await (await pool.resolve()).wait();
  const phase = await pool.phase();
  check(phase === 2n, "graduated on real criteria", `phase ${phase}`);
  if (phase !== 2n) throw new Error("did not graduate");

  log(`\n7. migrate and verify on Uniswap`);
  const [ethBefore, tokBefore] = await pool.getReserves();
  const mig = await (await pool.migrate()).wait();
  const tokenId = await pool.migratedPositionId();
  const posm = await ethers.getContractAt(["function ownerOf(uint256) view returns (address)"], d.positionManager);
  check((await posm.ownerOf(tokenId)).toLowerCase() === r.locker.toLowerCase(),
    "position locked", `#${tokenId} gas ${mig.gasUsed}`);

  const stateView = await ethers.getContractAt(
    ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"],
    "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  );
  const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [ethers.ZeroAddress, r.token, 3000, 60, ethers.ZeroAddress]));
  const [sqrtNow] = await stateView.getSlot0(poolId);
  const priceMath = await ethers.getContractAt(
    ["function sqrtPriceX96FromReserves(uint256,uint256) pure returns (uint160)"], d.priceMath);
  const want = await priceMath.sqrtPriceX96FromReserves(ethBefore, tokBefore);
  const drift = sqrtNow > want ? sqrtNow - want : want - sqrtNow;
  check(drift * 10000n <= want, "v4 opened at the curve's price",
    `drift ${want === 0n ? 0 : Number(drift * 1000000n / want) / 10000}%`);

  log(`\n8. traders still hold their tokens after migration`);
  for (const [i, w] of traders.entries()) {
    const bal = await token.balanceOf(w.address);
    log(`   trader${i}: ${f(bal)} CROWD`);
    if (i < 3) check(bal > 0n, `trader${i} kept their position`);
  }

  log(`\n9. sweep leftover gas back to the bank`);
  for (const w of traders) {
    const bal = await provider.getBalance(w.address);
    // No explicit gasLimit: this is an Orbit chain, where a plain transfer
    // costs more than the 21,000 intrinsic minimum because of the L1 calldata
    // component. Pinning it to 21,000 fails with "intrinsic gas too low".
    const gas = (await provider.getFeeData()).gasPrice * 300_000n;
    if (bal > gas) {
      await (await w.sendTransaction({ to: bank.address, value: bal - gas })).wait();
    }
  }
  log(`   bank now ${f(await provider.getBalance(bank.address))} ETH`);

  log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
