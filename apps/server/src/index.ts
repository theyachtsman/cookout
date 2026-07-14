import { createServer } from "node:http";
import { RoundEngine } from "./engine.js";
import { createApp } from "./routes.js";
import { autoScheduler, seedDemo } from "./seed.js";
import { Store } from "./store.js";
import { Hub } from "./ws.js";

const PORT = Number(process.env.PORT ?? 4000);
const ADMIN_KEY = process.env.ADMIN_KEY ?? "dev-admin";
const SEED = process.env.SEED !== "0";

const store = new Store();
const hub = new Hub(store);
const engine = new RoundEngine(store, hub.broadcast, hub.spectatorCount);
const app = createApp(store, engine, ADMIN_KEY);
const server = createServer(app);
hub.attach(server);

if (SEED) seedDemo(store, engine);

setInterval(() => {
  try {
    engine.tick(Date.now());
    if (SEED) autoScheduler(store, engine);
  } catch (e) {
    console.error("tick error", e);
  }
}, 1000);

server.listen(PORT, process.env.HOST ?? "0.0.0.0", () => {
  console.log(`The Cookout server listening on :${PORT} (ws at /ws)`);
  if (ADMIN_KEY === "dev-admin")
    console.log("warning: using default ADMIN_KEY — set ADMIN_KEY in production");
});
