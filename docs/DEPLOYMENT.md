# Deploying The Cookout

## Architecture

```
Browser ──▶ Vercel (Next.js web app, static + SSR)
   │
   └──HTTPS/WSS──▶ Cloudflare ──▶ your server: API + WebSocket (:4000)
                                        └── PostgreSQL (docker compose)
```

**Vercel can only host the web app.** The API is a long-running WebSocket server
with an in-memory game engine — it must run on your own server. The web app never
talks to Postgres directly; it only talks to the API.

## 1. Vercel (web app)

Project settings:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js (auto-detected) |
| Install / Build command | defaults (`npm install`, `npm run build`) |
| Env var `NEXT_PUBLIC_API_URL` | `https://api.<your-domain>` (your Cloudflare hostname for the API) |

The `prebuild` hook in `apps/web/package.json` compiles `@cookout/shared` first —
this is what fixes the "module not found @cookout/shared" build error (its `dist/`
is gitignored, so it must be built during deploy).

Every push to `main` redeploys automatically once GitHub is connected.

## 2. Your server (API + Postgres)

```bash
git clone https://github.com/theyachtsman/cookout && cd cookout
npm install
npm run build -w @cookout/shared
docker compose up -d          # PostgreSQL on 127.0.0.1:5434

ADMIN_KEY=<long-random-string> \
DATABASE_URL=postgres://cookout:cookout@127.0.0.1:5434/cookout \
CORS_ORIGIN=https://<your-vercel-domain> \
SEED=1 \
node --import tsx apps/server/src/index.ts
```

Environment variables:

| Var | Purpose |
| --- | --- |
| `ADMIN_KEY` | **Set a strong one.** Default `dev-admin` is dev-only. |
| `DATABASE_URL` | Postgres; omit to fall back to a JSON file snapshot. |
| `CORS_ORIGIN` | Lock the API to your web origin (default `*`). |
| `SEED` | `1` keeps the demo auto-scheduler filling the calendar. |
| `PORT` / `HOST` | Default `4000` / `0.0.0.0`. |

Run it under systemd so it survives reboots:

```ini
# /etc/systemd/system/cookout.service
[Unit]
Description=The Cookout API
After=network.target docker.service

[Service]
WorkingDirectory=/opt/cookout
Environment=ADMIN_KEY=... DATABASE_URL=... CORS_ORIGIN=... SEED=1
ExecStart=/usr/bin/node --import tsx apps/server/src/index.ts
Restart=always

[Install]
WantedBy=multi-user.target
```

Note: sessions are in-memory — an API restart signs everyone out (they just
reconnect their wallet). Game state persists via Postgres.

## 3. Cloudflare (expose the API)

Recommended: a **cloudflared tunnel** — no open ports on your server:

```bash
cloudflared tunnel create cookout
cloudflared tunnel route dns cookout api.<your-domain>
# config: ingress api.<your-domain> → http://localhost:4000
cloudflared tunnel run cookout
```

WebSockets pass through Cloudflare by default (`wss://api.<your-domain>/ws`);
the web app derives the WS URL from `NEXT_PUBLIC_API_URL` automatically.

## LAN testing (no deployment)

Run `npm run dev:server` and `npm run dev:web`, then open
`http://<machine-lan-ip>:3000` from any device on your network. When
`NEXT_PUBLIC_API_URL` is unset the page targets the same host on port 4000,
so LAN devices work without configuration. Allow ports 3000/4000 through the
machine's firewall if needed.

## Crowd testing with the bot swarm

```bash
node apps/server/scripts/bots.mjs http://127.0.0.1:4000 25
```

Spawns 25 bots with mixed personas (scalpers, holders, whales, degens) that
sign in with their own wallets, vote, queue auction intents, trade live, chat,
cheer, and predict — watch the chart and feeds under load from the browser.
They're ordinary users; run it against staging too.
