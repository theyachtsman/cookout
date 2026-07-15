import { createServer } from "node:http";
import { RoundEngine } from "./engine.js";
import { FilePersistence, PgPersistence, type Persistence } from "./persistence.js";
import { createApp } from "./routes.js";
import { autoScheduler, seedDemo } from "./seed.js";
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
const app = createApp(store, engine, ADMIN_KEY, hub.broadcast);
const server = createServer(app);
hub.attach(server);

if (SEED && store.concepts.size === 0) seedDemo(store, engine);

setInterval(() => {
  try {
    engine.tick(Date.now());
    if (SEED) autoScheduler(store, engine);
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
