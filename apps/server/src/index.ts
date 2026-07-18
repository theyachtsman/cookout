import { createServer } from "node:http";
import { ChainService } from "./chain.js";
import { RoundEngine } from "./engine.js";
import { settleWeeklyJackpot } from "./jackpot.js";
import { FilePersistence, PgPersistence, type Persistence } from "./persistence.js";
import { createApp } from "./routes.js";
import { autoScheduler, evaluateVoting, seedDemo } from "./seed.js";
import { Store } from "./store.js";
import { Hub } from "./ws.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY ?? "dev-admin";
const SEED = process.env.SEED !== "0";
const SAVE_INTERVAL_MS = Number(process.env.SAVE_INTERVAL_MS ?? 10_000);

const store = new Store();
const persistence: Persistence = process.env.DATABASE_URL
  ? new PgPersistence(process.env.DATABASE_URL)
  : new FilePersistence(process.env.DATA_FILE ?? new URL("../data/state.json", import.meta.url).pathname);

const snapshot = await persistence.load();
if (snapshot) {
  store.hydrate(snapshot);
  console.log(
    `hydrated ${snapshot.users.length} users, ${snapshot.concepts.length} concepts, ${snapshot.archivedRounds.length} archived rounds` +
      (process.env.DATABASE_URL ? " from PostgreSQL" : " from file snapshot"),
  );
}

const hub = new Hub(store);
const engine = new RoundEngine(store, hub.broadcast, hub.spectatorCount);
const chain = new ChainService(store, engine);
const app = createApp(store, engine, ADMIN_KEY, hub.broadcast, chain);
const server = createServer(app);
hub.attach(server);

if (SEED && store.concepts.size === 0) seedDemo(store, engine);
if (!snapshot?.settings && !SEED) store.settings.autoSchedule = false;

// Live ETH/USD feed: pegs the $40k bond target. Coinbase spot with a
// CoinGecko fallback; keeps the last good price if both fail.
async function refreshEthPrice(): Promise<void> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { data?: { amount?: string } };
    const p = Number(j.data?.amount);
    if (p > 0) {
      store.ethUsd = p;
      return;
    }
    throw new Error("bad coinbase payload");
  } catch {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(8000) },
      );
      const j = (await r.json()) as { ethereum?: { usd?: number } };
      if (j.ethereum?.usd && j.ethereum.usd > 0) store.ethUsd = j.ethereum.usd;
    } catch {
      console.warn(`eth price feed unreachable — keeping $${store.ethUsd}`);
    }
  }
}
await refreshEthPrice();
console.log(`ETH/USD: $${store.ethUsd} — bond target ≈ ${(40_000 / store.ethUsd).toFixed(2)} pETH mcap`);
setInterval(() => void refreshEthPrice(), 10 * 60_000);

if (chain.enabled) {
  console.log(
    `chain service ON — operator ${chain.operatorAddress}, factory ${process.env.CHAIN_FACTORY}, ` +
      `chain ${process.env.CHAIN_ID}, scale ${chain.scale}`,
  );
  // Fire-and-forget: ChainService.tick self-guards against overlap. 1.5s keeps
  // the mirrored chart snappy; the guard absorbs slow RPC round-trips.
  setInterval(() => void chain.tick(Date.now()), 1500);
}

setInterval(() => {
  try {
    engine.tick(Date.now());
    evaluateVoting(store);
    // Chain-only deployments never auto-spawn paper rounds, regardless of
    // the Live Ops toggle — real rounds cost the operator real gas/liquidity,
    // so they stay deliberate (admin schedule-chain).
    if (process.env.CHAIN_ONLY !== "1") autoScheduler(store, engine);
    const payout = settleWeeklyJackpot(store, Date.now());
    if (payout)
      console.log(
        `weekly jackpot ${payout.week} paid: ${payout.totalEth.toFixed(4)} pETH ` +
          `to ${payout.winners.length} winners (≈ $${payout.totalUsd.toFixed(0)})`,
      );
  } catch (e) {
    console.error("tick error", e);
  }
}, 1000);

let saving = false;
setInterval(() => {
  if (saving) return;
  saving = true;
  persistence
    .save(store.snapshot())
    .catch((e) => console.error("persist error", e))
    .finally(() => (saving = false));
}, SAVE_INTERVAL_MS);

const shutdown = async () => {
  try {
    await persistence.save(store.snapshot());
    await persistence.close();
  } catch (e) {
    console.error("shutdown persist error", e);
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`The Cookout server listening on ${HOST}:${PORT} (ws at /ws)`);
  if (ADMIN_KEY === "dev-admin")
    console.log("warning: using default ADMIN_KEY — set ADMIN_KEY in production");
});
