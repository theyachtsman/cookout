/**
 * End-to-end verification of the Phase 1 loop over real HTTP + WebSocket:
 * wallets sign in, a creator submits a concept, the community votes, the
 * committee schedules, bots queue intents (one limit intent priced to be
 * excluded), the auction settles, bots trade live, the round ends on timer,
 * and the script independently recomputes the settlement audit hash from the
 * published intents — the external-auditor path.
 *
 * Usage: node scripts/e2e.mjs [apiUrl] (default http://127.0.0.1:4000)
 */
import { WebSocket } from "ws";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { settleAuction } from "@cookout/shared";

const API = process.argv[2] ?? "http://127.0.0.1:4000";
const ADMIN = process.env.ADMIN_KEY ?? "dev-admin";

const j = async (path, { method, body, token, admin } = {}) => {
  const res = await fetch(API + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(admin ? { "x-admin-key": ADMIN } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  return data;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
};

async function makeBot(name) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { message } = await j("/api/auth/nonce", { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const { token, profile } = await j("/api/auth/verify", {
    body: { address: account.address, signature },
  });
  return { name, account, token, address: profile.address };
}

const [creator, alice, bob, carol] = await Promise.all(
  ["creator", "alice", "bob", "carol"].map(makeBot),
);
check(true, "4 wallets signed in via nonce + personal_sign");

// Creator economy: submit → vote → shortlist → schedule (fast test config).
const concept = await j("/api/concepts", {
  token: creator.token,
  body: { name: "E2E Special", symbol: "E2E", theme: "verification run" },
});
await j(`/api/concepts/${concept.id}/vote`, { token: alice.token, body: {} });
await j(`/api/concepts/${concept.id}/vote`, { token: bob.token, body: {} });
await j(`/api/admin/concepts/${concept.id}/shortlist`, { admin: true, body: {} });
const round = await j(`/api/admin/concepts/${concept.id}/schedule`, {
  admin: true,
  body: {
    tier: "rookie",
    inSeconds: 2,
    config: { lobbySeconds: 3, queueSeconds: 6, maxDurationSeconds: 15, lowVolumeWindowSeconds: 120 },
  },
});
check(round.state === "scheduled", `round scheduled (${round.id})`);

// Spectate over WS and count event types.
const seen = new Map();
const ws = new WebSocket(API.replace("http", "ws") + "/ws");
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", roundId: round.id })));
ws.on("message", (raw) => {
  const e = JSON.parse(raw.toString());
  seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
});

// Wait for the queue, then submit intents (carol's limit is set to be excluded).
const waitState = async (states, timeoutMs = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { round: r } = await j(`/api/rounds/${round.id}`);
    if (states.includes(r.state)) return r;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${states}`);
};

await waitState(["queue_open"]);
const spot = round.config.initialEthLiquidity / round.config.initialTokenLiquidity;
await j(`/api/rounds/${round.id}/intents`, { token: alice.token, body: { ethAmount: 2 } });
await j(`/api/rounds/${round.id}/intents`, { token: bob.token, body: { ethAmount: 1 } });
await j(`/api/rounds/${round.id}/intents`, {
  token: carol.token,
  body: { ethAmount: 1, maxPrice: spot * 1.000001 },
});
const agg = await j(`/api/rounds/${round.id}/intents`);
check(
  agg.count === 3 && agg.bids?.length === 3 && agg.intents === undefined,
  "queue shows live bid board (no limit prices) while open",
);
check(
  agg.bids.every((b) => b.ethAmount > 0 && b.userAddress && b.maxPrice === undefined),
  "bid board hides limit prices until settlement",
);
await j(`/api/rounds/${round.id}/predict`, { token: alice.token, body: { call: "moon" } });
await j(`/api/rounds/${round.id}/predict`, { token: carol.token, body: { call: "rug" } });

// Settlement.
await waitState(["live"]);
const auction = await j(`/api/rounds/${round.id}/auction`);
check(auction.fills.length === 3, "auction settled all 3 intents");
const carolFill = auction.fills.find((f) => f.userAddress === carol.address);
check(carolFill.ethFilled === 0 && carolFill.refund === 1, "limit below clearing → full refund");
const aliceFill = auction.fills.find((f) => f.userAddress === alice.address);
const bobFill = auction.fills.find((f) => f.userAddress === bob.address);
check(
  Math.abs(aliceFill.tokensOut / bobFill.tokensOut - 2) < 1e-9,
  "uniform price: fills proportional to committed ETH",
);

// Independent audit: recompute the settlement from published intents.
const { intents } = await j(`/api/rounds/${round.id}/intents`);
const recomputed = settleAuction({
  roundId: round.id,
  intents,
  pool: {
    ethReserve: round.config.initialEthLiquidity,
    tokenReserve: round.config.initialTokenLiquidity,
    totalSupply: round.config.totalSupply,
  },
  maxRaise: round.config.auctionMaxRaise,
  feeBps: round.config.auctionFeeBps,
});
check(recomputed.auditHash === auction.auditHash, "audit hash recomputed independently — settlement verified");

// Live trading.
await j(`/api/rounds/${round.id}/trade`, { token: bob.token, body: { side: "buy", eth: 2 } });
await j(`/api/rounds/${round.id}/trade`, { token: alice.token, body: { side: "sell", pct: 50 } });
await j(`/api/rounds/${round.id}/trade`, { token: alice.token, body: { side: "sell", pct: 100 } });
const me = await j(`/api/rounds/${round.id}/me`, { token: alice.token });
check(me.position.tokens === 0, "alice fully exited (spectator)");

// Chat, cheers, and moderation over WS.
const aliceWs = new WebSocket(API.replace("http", "ws") + `/ws?token=${alice.token}`);
await new Promise((r) => aliceWs.on("open", r));
aliceWs.send(JSON.stringify({ type: "subscribe", roundId: round.id }));
await sleep(200);
aliceWs.send(JSON.stringify({ type: "chat", roundId: round.id, text: "lets cook" }));
aliceWs.send(JSON.stringify({ type: "react", roundId: round.id, emoji: "🔥" }));
await sleep(400);
check((seen.get("chat") ?? 0) >= 1, "chat message delivered");
check((seen.get("reaction") ?? 0) >= 1, "cheer reaction delivered");
const { chat: chatLog } = await j(`/api/rounds/${round.id}`);
const msg = chatLog.find((m) => m.text === "lets cook");
await j(`/api/admin/chat/${round.id}/${msg.id}`, { admin: true, method: "DELETE" });
const { chat: chatAfter } = await j(`/api/rounds/${round.id}`);
check(!chatAfter.some((m) => m.id === msg.id), "moderator deleted message");
await j(`/api/admin/users/${alice.address}/mute`, { admin: true, body: { minutes: 5 } });
aliceWs.send(JSON.stringify({ type: "chat", roundId: round.id, text: "muted?" }));
await sleep(400);
const { chat: chatMuted } = await j(`/api/rounds/${round.id}`);
check(!chatMuted.some((m) => m.text === "muted?"), "muted player cannot chat");
aliceWs.close();

// Current-match leaderboard while live.
const liveLb = await j(`/api/leaderboard?scope=round&roundId=${round.id}`);
check(liveLb.rows.length >= 2, "current-match leaderboard has positions");

// Round end on timer + results.
const ended = await waitState(["results"], 40000);
check(ended.endReason === "timer", `round ended by timer`);
const { summary } = await j(`/api/rounds/${round.id}`);
check(!!summary?.winner, "summary has a winner");
const aliceProfile = await j(`/api/profile/${alice.address}`);
check(aliceProfile.xp > 0, `XP awarded (alice: ${aliceProfile.xp})`);
check(aliceProfile.stats.roundsPlayed === 1, "stats updated");
const lb = await j("/api/leaderboard?scope=alltime&metric=xp");
check(lb.rows.length >= 3, "leaderboard populated");
const today = await j("/api/leaderboard?scope=today&metric=pnl");
check(today.rows.some((r) => r.address === bob.address), "today leaderboard from round history");

// Public trading history + creator profile view.
const hist = await j(`/api/profile/${alice.address}/history`);
check(hist.length === 1 && hist[0].symbol === "E2E", "trading history recorded");
const cv = await j(`/api/creator/${creator.address}`);
check(cv.aggregates.submissions === 1 && cv.aggregates.roundsLaunched === 1, "creator view aggregates");
check(cv.rounds[0].summary !== null, "creator view includes round summary");
const mySt = await j("/api/missions", { token: bob.token });
check(mySt.some((m) => m.completed), "at least one mission completed by playing");

await sleep(500);
ws.close();
const types = [...seen.keys()].sort();
console.log(`   ws events seen: ${types.join(", ")}`);
for (const t of ["round_state", "lobby_update", "auction_settled", "trade", "ticker", "round_end"])
  check(seen.has(t), `ws delivered ${t}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
