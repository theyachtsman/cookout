/**
 * Bot swarm for crowd-testing the arena: N simulated players with distinct
 * personas sign in with their own wallets, vote on the launchpad, queue
 * auction intents, trade live with varied sizes and cadence, predict, and
 * chat — so you can watch the chart, feeds, and leaderboards behave under a
 * real multi-user load.
 *
 * Usage: node scripts/bots.mjs [apiUrl] [count]
 *        node scripts/bots.mjs http://127.0.0.1:4000 25
 * Stop with Ctrl-C. Bots are ordinary users; no special server support.
 */
import { WebSocket } from "ws";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = process.argv[2] ?? "http://127.0.0.1:4000";
const COUNT = Number(process.argv[3] ?? 20);

const PERSONAS = [
  { name: "scalper", tradeEveryMs: [1200, 4000], buyEth: [0.005, 0.04], sellPct: [20, 60], exitEarly: 0.5 },
  { name: "holder", tradeEveryMs: [6000, 15000], buyEth: [0.02, 0.1], sellPct: [0, 25], exitEarly: 0.05 },
  { name: "whale", tradeEveryMs: [5000, 12000], buyEth: [0.08, 0.3], sellPct: [40, 100], exitEarly: 0.2 },
  { name: "degen", tradeEveryMs: [800, 2500], buyEth: [0.01, 0.08], sellPct: [50, 100], exitEarly: 0.35 },
];

const CHATS = [
  "lets cook 🔥", "this one has legs", "im out lol", "diamond hands only",
  "whale incoming?", "chart looking spicy", "who sold??", "moon time",
  "burnt incoming, watch", "average entry looking clean",
];

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, { method, body, token } = {}) {
  const res = await fetch(API + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function runBot(i) {
  const persona = PERSONAS[i % PERSONAS.length];
  const account = privateKeyToAccount(generatePrivateKey());
  const { message } = await j("/api/auth/nonce", { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const { token } = await j("/api/auth/verify", { body: { address: account.address, signature } });
  await j("/api/me", { method: "PATCH", token, body: { displayName: `${persona.name}_${i}` } });

  let ws = null;
  let joinedRound = null;

  const ensureWs = (roundId) => {
    if (joinedRound === roundId && ws?.readyState === WebSocket.OPEN) return;
    try { ws?.close(); } catch {}
    ws = new WebSocket(API.replace("http", "ws") + `/ws?token=${token}`);
    ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", roundId })));
    ws.on("error", () => {});
    joinedRound = roundId;
  };

  let intentRound = null;
  let nextTradeAt = 0;
  let predicted = null;

  for (;;) {
    try {
      const rounds = await j("/api/calendar");
      const active = rounds.find((r) =>
        ["lobby", "queue_open", "settling", "live"].includes(r.state),
      );
      if (!active) {
        // Occasionally upvote something on the launchpad while idle.
        if (Math.random() < 0.1) {
          const concepts = await j("/api/concepts?status=submitted");
          if (concepts.length) await j(`/api/concepts/${pick(concepts).id}/vote`, { token, body: {} }).catch(() => {});
        }
        await sleep(2000);
        continue;
      }
      ensureWs(active.id);

      if ((active.state === "lobby" || active.state === "queue_open") && predicted !== active.id && Math.random() < 0.3) {
        await j(`/api/rounds/${active.id}/predict`, { token, body: { call: Math.random() < 0.6 ? "moon" : "rug" } }).catch(() => {});
        predicted = active.id;
      }

      if (active.state === "queue_open" && intentRound !== active.id) {
        const me = await j("/api/me", { token });
        const amount = Math.min(0.25, me.paperBalance * 0.5, rand(...persona.buyEth) * 2);
        if (amount > 0.005) {
          await j(`/api/rounds/${active.id}/intents`, {
            token,
            body: { ethAmount: Number(amount.toFixed(3)) },
          }).catch(() => {});
          intentRound = active.id;
        }
      }

      if (active.state === "live" && Date.now() >= nextTradeAt) {
        nextTradeAt = Date.now() + rand(...persona.tradeEveryMs);
        const mine = await j(`/api/rounds/${active.id}/me`, { token });
        const holding = mine.position.tokens > 0;
        const wantSell = holding && (Math.random() < persona.exitEarly || mine.balance < 0.1);
        if (wantSell) {
          await j(`/api/rounds/${active.id}/trade`, {
            token,
            body: { side: "sell", pct: Math.round(rand(...persona.sellPct)) || 25 },
          }).catch(() => {});
        } else if (mine.balance > 0.02) {
          const eth = Math.min(mine.balance * 0.4, rand(...persona.buyEth));
          if (eth > 0.004)
            await j(`/api/rounds/${active.id}/trade`, {
              token,
              body: { side: "buy", eth: Number(eth.toFixed(3)) },
            }).catch(() => {});
        }
        if (Math.random() < 0.12 && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "chat", roundId: active.id, text: pick(CHATS) }));
        }
        if (Math.random() < 0.15 && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "react", roundId: active.id, emoji: pick(["🔥", "🚀", "😂", "💀"]) }));
        }
      }
      await sleep(600);
    } catch (e) {
      // keep the swarm alive through transient errors
      await sleep(1500 + Math.random() * 1500);
      void e;
    }
  }
}

console.log(`spawning ${COUNT} bots against ${API} …`);
for (let i = 0; i < COUNT; i++) {
  runBot(i).catch((e) => console.error(`bot ${i} died:`, e.message));
  await sleep(150);
}
