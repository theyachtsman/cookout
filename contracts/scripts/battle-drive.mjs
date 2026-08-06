/**
 * A Battle the Goon Squad match, end to end, with real money on the real chain.
 *
 * Two players stake from their own wallets, the server verifies against the
 * pools rather than believing them, the match runs, the outcome is posted
 * on-chain, and the winner claims. This is the path the UI takes — the same
 * one that reverted on the first real attempt.
 */
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.API ?? "https://api-dev.thecookout.fun";
const RPC = "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: 46630, name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http() });
const log = (...a) => console.log(...a);
let bad = 0;
const check = (ok, label, detail = "") => {
  log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};

async function call(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${typeof d === "string" ? d.slice(0,160) : JSON.stringify(d).slice(0,260)}`);
  return d;
}
async function signIn(acct) {
  const { message } = await call("/api/auth/nonce", { body: { address: acct.address } });
  const signature = await acct.signMessage({ message });
  return (await call("/api/auth/verify", { body: { address: acct.address, signature } })).token;
}
const SEL = { stake: "0x604f2177", enter: "0xe97dcb62", claim: "0x4e71d92d", pending: "0x5eebea20" };
const pad = (v) => BigInt(v).toString(16).padStart(64, "0");

async function send(acct, to, data, value = 0n) {
  const w = createWalletClient({ account: acct, chain, transport: http() });
  const [gasPrice, gas] = await Promise.all([
    pub.getGasPrice(),
    pub.estimateGas({ account: acct.address, to, data, value }),
  ]);
  const hash = await w.sendTransaction({ to, data, value, gasPrice, gas: (gas * 13n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error("reverted");
  return hash;
}

const bank = privateKeyToAccount(process.env.DEPLOYER_KEY);
const p2 = privateKeyToAccount(keccak256(toHex("cookout-battle-p2")));
log(`p1 ${bank.address}\np2 ${p2.address}`);

// Fund p2 for entry + gas.
const need = 8_000_000_000_000_000n;
if ((await pub.getBalance({ address: p2.address })) < need) {
  const w = createWalletClient({ account: bank, chain, transport: http() });
  const h = await w.sendTransaction({ to: p2.address, value: need, gasPrice: await pub.getGasPrice() });
  await pub.waitForTransactionReceipt({ hash: h });
}

const t1 = await signIn(bank), t2 = await signIn(p2);
log(`\n1. launch a Pit match`);
const launched = await call("/api/pit/launch", {
  token: t1,
  body: { name: "Full Battle", symbol: "FBTL", theme: "end to end with real money",
          duration: "blitz", predictionMode: true, tradingMode: true },
});
const id = launched.id ?? launched.round?.id;
log(`   round ${id}`);

log(`\n2. wait for the server to deploy pools`);
let pc = null;
for (let i = 0; i < 40 && !pc; i++) {
  pc = (await call(`/api/rounds/${id}`)).round?.pitChain;
  if (!pc) await new Promise((s) => setTimeout(s, 3000));
}
if (!pc) { log("   NO POOLS"); process.exit(1); }
log(`   battle ${pc.battlePool}  entry ${pc.battleEntryWei} wei ($${pc.battleEntryUsd})`);
const closes = new Date(pc.closesAt);
check(closes.getTime() > Date.now(), "staking is OPEN, not born closed", closes.toISOString());

log(`\n3. both players stake on-chain, then register`);
const entry = BigInt(pc.battleEntryWei);
for (const [who, acct, tok, call_] of [["p1", bank, t1, 1], ["p2", p2, t2, 2]]) {
  await send(acct, pc.predictionPool, SEL.stake + pad(call_), entry);
  await send(acct, pc.battlePool, SEL.enter, entry);
  const r = await call(`/api/pit/${id}/enter`, {
    token: tok,
    body: { prediction: call_ === 1 ? "graduate" : "rug", predictionStake: 5, trading: true, battleTier: "easy" },
  });
  log(`   ${who} staked + registered (tier ${r.entry?.battleTier})`);
}
const potWei = await pub.getBalance({ address: pc.battlePool });
check(potWei === entry * 2n, "battle pot holds both entries", `${Number(potWei) / 1e18} ETH`);

log(`\n4. the server must refuse an entry nobody paid for`);
const p3 = privateKeyToAccount(keccak256(toHex("cookout-battle-freeloader")));
try {
  const t3 = await signIn(p3);
  await call(`/api/pit/${id}/enter`, { token: t3, body: { trading: true, battleTier: "easy" } });
  check(false, "an unpaid entry was accepted");
} catch (e) {
  check(/402|pool first/.test(e.message), "unpaid entry refused", e.message.slice(0, 80));
}

log(`\n5. trade during the match so the battle has a winner`);
let state = "";
for (let i = 0; i < 120; i++) {
  const r = (await call(`/api/rounds/${id}`)).round;
  if (r.state !== state) { log(`   state → ${r.state}`); state = r.state; }
  if (r.state === "live") {
    try { await call(`/api/rounds/${id}/trade`, { token: t1, body: { side: "buy", eth: 20 } }); } catch {}
    try { await call(`/api/rounds/${id}/trade`, { token: t2, body: { side: "buy", eth: 5 } }); } catch {}
  }
  if (r.state === "results" || r.state === "cancelled") {
    // Resolution is fire-and-forget: the state flips the instant the match
    // ends and the on-chain post lands a few seconds later. Checking straight
    // away reports a failure that has not happened yet.
    log(`   match over — waiting for the outcome to land on-chain`);
    for (let j = 0; j < 30; j++) {
      const done = await pub.call({ to: pc.predictionPool, data: "0x3f6fa655" });
      if (BigInt(done.data ?? "0x0") === 1n) break;
      await new Promise((s) => setTimeout(s, 3000));
    }
    log(`   resolvedTx ${(await call(`/api/rounds/${id}`)).round?.pitChain?.resolvedTx ?? "(none)"}`);
    break;
  }
  await new Promise((s) => setTimeout(s, 4000));
}

log(`\n6. verify on-chain and claim`);
const read = (to, data) => pub.call({ to, data }).then((r) => BigInt(r.data ?? "0x0"));
check((await read(pc.predictionPool, "0x3f6fa655")) === 1n, "prediction pool resolved");
const winner = "0x" + (await pub.call({ to: pc.battlePool, data: "0xdfbf53ae" })).data.slice(-40);
log(`   battle winner on-chain: ${winner}`);
check(winner !== "0x" + "0".repeat(40), "a winner was named");

for (const [who, acct] of [["p1", bank], ["p2", p2]]) {
  for (const [label, pool] of [["prediction", pc.predictionPool], ["battle", pc.battlePool]]) {
    const owed = await read(pool, SEL.pending + pad(BigInt(acct.address)));
    if (owed === 0n) continue;
    const before = await pub.getBalance({ address: acct.address });
    await send(acct, pool, SEL.claim);
    const after = await pub.getBalance({ address: acct.address });
    log(`   ${who} claimed ${label}: owed ${Number(owed)/1e18}, balance +${Number(after-before)/1e18} ETH`);
    check(after > before, `${who} was actually paid from the ${label} pool`);
  }
}

log(`\n${bad === 0 ? "ALL CHECKS PASSED" : `${bad} FAILED`}`);
process.exit(bad ? 1 : 0);
