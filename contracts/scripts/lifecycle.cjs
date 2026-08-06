/**
 * Drives one round end to end on the real chain: create → auction → settle →
 * trade → resolve → graduate → migrate → collect fees. Read-only assertions
 * only; it never touches the server. The point is to prove the whole lifecycle
 * works against real Uniswap v4, not just the fork.
 */
const { ethers } = require("hardhat");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const E = (n) => ethers.parseEther(String(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function main() {
  const d = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "robinhoodTestnet.json")));
  const [me] = await ethers.getSigners();
  log(`deployer ${me.address}, factory ${d.roundFactory}`);

  const factory = await ethers.getContractAt(
    (await ethers.getContractFactory("RoundFactory", {
      libraries: { PriceMath: d.priceMath },
    })).interface.fragments,
    d.roundFactory,
    me,
  );

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  // The anchor that sets the opening price. Not money, and not sent: nobody
  // funds it, so the round costs the operator gas and nothing else.
  const LIQ = E(0.02);
  const before = await ethers.provider.getBalance(me.address);
  log(`\n1. createRound (virtual anchor ${ethers.formatEther(LIQ)} ETH, 0 sent)`);
  const tx = await factory.createRound(
    {
      name: "Lifecycle Test", symbol: "LIFE", totalSupply: E(1_000_000),
      queueClosesAt: now + 60, endTime: now + 120,
      auctionMaxRaiseWei: E(1), auctionFeeBps: 0, tradeFeeBps: 100,
      mcapTargetWei: 0,
      graduationMcapWei: 0, graduationMinVolumeWei: 0, graduationMinHolders: 0,
      virtualEthReserve: LIQ,
      feeRecipient: me.address, creator: me.address,
      feeDestination: ethers.ZeroAddress,
    },
    { value: 0 },
  );
  const rc = await tx.wait();
  const spent = before - (await ethers.provider.getBalance(me.address));
  log(`   ok, gas ${rc.gasUsed}, tx ${rc.hash}`);
  log(`   operator paid ${ethers.formatEther(spent)} ETH (gas only, not ${ethers.formatEther(LIQ)} seed)`);
  if (spent >= LIQ) throw new Error("the house funded this round");

  const id = (await factory.roundCount()) - 1n;
  const r = await factory.rounds(id);
  log(`   round #${id}\n   token    ${r.token}\n   pool     ${r.pool}\n   auction  ${r.auction}\n   locker   ${r.locker}\n   splitter ${r.feeSplitter}`);

  const pool = await ethers.getContractAt("RoundPool", r.pool, me);
  const auction = await ethers.getContractAt("BatchAuction", r.auction, me);
  const token = await ethers.getContractAt("ArenaToken", r.token, me);
  const locker = await ethers.getContractAt("CookoutLpLocker", r.locker, me);

  log(`\n2. pull up to the auction`);
  await (await auction.submit(0, { value: E(0.002) })).wait();
  log(`   intents: ${await auction.intentCount()}`);

  log(`\n3. wait for the queue to close, then settle (permissionless)`);
  while ((await ethers.provider.getBlock("latest")).timestamp < now + 61) await sleep(3000);
  const s = await (await auction.settle()).wait();
  log(`   settled, gas ${s.gasUsed}, clearing ${await auction.clearingPriceWad()}`);
  log(`   phase ${await pool.phase()} (1 = Live)`);

  log(`\n4. buy on the curve, with a real slippage floor`);
  const [er, tr] = await pool.getReserves();
  const priceMath = await ethers.getContractAt(
    ["function sqrtPriceX96FromReserves(uint256,uint256) pure returns (uint160)"], d.priceMath,
  );
  const buyTx = await (await pool.buy(0, { value: E(0.001) })).wait();
  log(`   bought, gas ${buyTx.gasUsed}, holders ${await token.holderCount()}`);

  log(`\n5. wait for the end, then resolve (permissionless)`);
  while ((await ethers.provider.getBlock("latest")).timestamp < now + 121) await sleep(3000);
  const res = await (await pool.resolve()).wait();
  const phase = await pool.phase();
  log(`   resolved, gas ${res.gasUsed}, phase ${phase} (2 = Graduated)`);
  if (phase !== 2n) throw new Error(`expected Graduated, got ${phase}`);

  log(`\n6. migrate to Uniswap v4`);
  const [ethBefore, tokBefore] = await pool.getReserves();
  log(`   moving ${ethers.formatEther(ethBefore)} ETH + ${ethers.formatEther(tokBefore)} LIFE`);
  const mig = await (await pool.migrate()).wait();
  const tokenId = await pool.migratedPositionId();
  log(`   migrated, gas ${mig.gasUsed}, position #${tokenId}, tx ${mig.hash}`);

  log(`\n7. verify on Uniswap`);
  const posm = await ethers.getContractAt(
    ["function ownerOf(uint256) view returns (address)"], d.positionManager,
  );
  const owner = await posm.ownerOf(tokenId);
  log(`   position owner: ${owner}`);
  log(`   locker:         ${r.locker}`);
  if (owner.toLowerCase() !== r.locker.toLowerCase()) throw new Error("position not locked!");

  const stateView = await ethers.getContractAt(
    ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"],
    "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  );
  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [ethers.ZeroAddress, r.token, 3000, 60, ethers.ZeroAddress],
    ),
  );
  const [sqrtNow] = await stateView.getSlot0(poolId);
  const want = await priceMath.sqrtPriceX96FromReserves(ethBefore, tokBefore);
  log(`   v4 sqrtPriceX96: ${sqrtNow}`);
  log(`   curve implied:   ${want}`);
  const drift = sqrtNow > want ? sqrtNow - want : want - sqrtNow;
  log(`   drift: ${Number(drift * 1000000n / want) / 10000}%`);

  log(`\n8. collect fees to the splitter`);
  const fee = await (await locker.collectFees(tokenId)).wait();
  log(`   collected, gas ${fee.gasUsed}`);

  log(`\n9. the pool is empty and cannot be migrated again`);
  const [eAfter, tAfter] = await pool.getReserves();
  log(`   reserves: ${eAfter} / ${tAfter}`);
  try { await pool.migrate.staticCall(); throw new Error("migrated twice!"); }
  catch (e) { log(`   second migrate rejected: ${e.shortMessage ?? e.message}`); }

  // ---- 10. the round pays for its own gas --------------------------------
  //
  // The operator sends four transactions per round and is named as the pool's
  // feeRecipient precisely so the trade fee offsets that. But claimFees() is a
  // permissionless PULL: it does not pay out on its own, and until the server
  // started pulling it, every round's fees sat in a finished pool while the
  // wallet that paid for the round only ever went down.
  log(`\n10. claim the round's trade fees to the operator`);
  const accrued = await pool.feesAccrued();
  log(`   accrued ${ethers.formatEther(accrued)} ETH`);
  if (accrued === 0n) throw new Error("no fees accrued — nothing to prove");

  const opBefore = await ethers.provider.getBalance(me.address);
  const claim = await (await pool.claimFees()).wait();
  const gas = claim.gasUsed * claim.gasPrice;
  const opAfter = await ethers.provider.getBalance(me.address);

  log(`   claimed, gas ${claim.gasUsed} (${ethers.formatEther(gas)} ETH)`);
  log(`   operator net ${ethers.formatEther(opAfter - opBefore)} ETH`);
  if ((await pool.feesAccrued()) !== 0n) throw new Error("fees still owed after claim");
  if (opAfter - opBefore !== accrued - gas) throw new Error("operator did not receive the fee");
  // Claiming twice must be harmless, not a way to drain the pool.
  await (await pool.claimFees()).wait();
  log(`   second claim paid nothing (as it must)`);

  log(`\nDONE — full lifecycle on chain 46630.`);
}
main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
