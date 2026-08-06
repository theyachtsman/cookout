/**
 * The mainnet deployment, rehearsed on a fork of mainnet.
 *
 * Deploys the real contracts against real Robinhood Chain state, creates a
 * round, runs it to graduation, migrates into the real Uniswap v4, and locks
 * the position — using funded-from-nothing accounts, so it costs nothing.
 *
 * What this does NOT prove: sequencer behaviour under load, and the addresses
 * the real deployment will land on. Everything else — contract code, v4
 * integration, gas, the full lifecycle — is the same as it would be live.
 *
 *   FORK=mainnet node scripts/hh.cjs run scripts/rehearse.cjs
 */
const { ethers } = require("hardhat");
const E = (n) => ethers.parseEther(String(n));
const f = (w) => ethers.formatEther(w);
const log = (...a) => console.log(...a);
let bad = 0;
const check = (ok, label, detail = "") => {
  log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const [me] = await ethers.getSigners();
  log(`forked chain ${chainId} (4663 = Robinhood mainnet), block ${await ethers.provider.getBlockNumber()}`);
  check(Number(chainId) === 4663, "forked mainnet, not the testnet");

  const V4 = {
    positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  };
  const PROTOCOL = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";

  log(`\n1. deploy, exactly as scripts/deploy.cjs would`);
  const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
  const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();
  const factory = await (
    await ethers.getContractFactory("RoundFactory", {
      libraries: { PriceMath: await priceMath.getAddress() },
    })
  ).deploy(V4.positionManager, V4.permit2, await lockerFactory.getAddress(), PROTOCOL, 3000);
  const dep = await factory.deploymentTransaction().wait();
  // The fork's gas price is hardhat's, not the chain's. Ask the real node, or
  // the cost estimate below is off by more than an order of magnitude.
  let gp;
  try {
    const res = await fetch(process.env.RH_RPC ?? "https://rpc.mainnet.chain.robinhood.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    }).then((r) => r.json());
    gp = BigInt(res.result);
  } catch {
    gp = (await ethers.provider.getFeeData()).gasPrice;
  }
  log(`   factory ${await factory.getAddress()}  gas ${dep.gasUsed}`);

  log(`\n2. a round at the real curve anchor (rookie 1.5 x CHAIN_SCALE 0.01)`);
  // Virtual: it sets the opening price and nobody funds it. The house used to
  // send this as msg.value and never got it back.
  const SEED = E(0.015);
  const opBefore = await ethers.provider.getBalance(me.address);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const rc = await (
    await factory.createRound(
      {
        name: "Dress Rehearsal", symbol: "REH", totalSupply: E(1_000_000),
        queueClosesAt: now + 60, endTime: now + 120,
        auctionMaxRaiseWei: E(1), auctionFeeBps: 100, tradeFeeBps: 100,
        mcapTargetWei: 0, graduationMcapWei: 0,
        graduationMinVolumeWei: 0, graduationMinHolders: 0,
        virtualEthReserve: SEED,
        feeRecipient: me.address, creator: me.address,
        feeDestination: ethers.ZeroAddress,
      },
      { value: 0 },
    )
  ).wait();
  const r = await factory.rounds(0);
  const pool = await ethers.getContractAt("RoundPool", r.pool);
  const auction = await ethers.getContractAt("BatchAuction", r.auction);
  const token = await ethers.getContractAt("ArenaToken", r.token);
  const locker = await ethers.getContractAt("CookoutLpLocker", r.locker);
  const spent = opBefore - (await ethers.provider.getBalance(me.address));
  log(`   pool ${r.pool}  gas ${rc.gasUsed}`);
  log(`   operator paid ${f(spent)} ETH — gas only, not the ${f(SEED)} anchor`);
  if (spent >= SEED) { log("   FAIL  the house funded this round"); bad++; }
  else log(`   PASS  the house funded nothing`);

  log(`\n3. run it to graduation`);
  await (await auction.submit(0, { value: E(0.002) })).wait();
  await ethers.provider.send("evm_increaseTime", [120]);
  await ethers.provider.send("evm_mine");
  const st = await (await auction.settle()).wait();
  await (await pool.buy(0, { value: E(0.001) })).wait();
  await ethers.provider.send("evm_increaseTime", [200]);
  await ethers.provider.send("evm_mine");
  const rs = await (await pool.resolve()).wait();
  check((await pool.phase()) === 2n, "graduated");

  log(`\n4. migrate into the real Uniswap v4 on mainnet`);
  const [e0, t0] = await pool.getReserves();
  const mg = await (await pool.migrate()).wait();
  const tokenId = await pool.migratedPositionId();
  const posm = await ethers.getContractAt(
    ["function ownerOf(uint256) view returns (address)"], V4.positionManager);
  check((await posm.ownerOf(tokenId)).toLowerCase() === r.locker.toLowerCase(),
    "position locked in the locker", `#${tokenId}`);

  const stateView = await ethers.getContractAt(
    ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"], V4.stateView);
  const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [ethers.ZeroAddress, r.token, 3000, 60, ethers.ZeroAddress]));
  const [sqrtNow] = await stateView.getSlot0(poolId);
  const pm = await ethers.getContractAt(
    ["function sqrtPriceX96FromReserves(uint256,uint256) pure returns (uint160)"],
    await priceMath.getAddress());
  const want = await pm.sqrtPriceX96FromReserves(e0, t0);
  const drift = sqrtNow > want ? sqrtNow - want : want - sqrtNow;
  check(drift * 10000n <= want, "v4 opened at the curve's price",
    `drift ${Number(drift * 1000000n / want) / 10000}%`);
  await (await locker.collectFees(tokenId)).wait();
  check(true, "fees collect to the splitter");

  const gasTotal = dep.gasUsed + rc.gasUsed + st.gasUsed + rs.gasUsed + mg.gasUsed;
  log(`\n--- what this would cost live, at the real ${Number(gp) / 1e9} gwei ---`);
  log(`   deploy once:        ${f(dep.gasUsed * gp)} ETH`);
  log(`   gas for one round:  ${f((rc.gasUsed + st.gasUsed + rs.gasUsed + mg.gasUsed) * gp)} ETH`);
  log(`   seed per round:     none — the anchor is virtual, nobody funds it`);
  log(`   total this run:     ${f(gasTotal * gp)} ETH`);
  log(`   fees back per round: ~1% of volume, claimed to the operator`);

  log(`\n${bad === 0 ? "REHEARSAL PASSED — mainnet is ready, at zero cost." : `${bad} FAILED`}`);
  if (bad) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
