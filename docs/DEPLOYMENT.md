# Deploying The Cookout — single VPS (Hetzner) + Cloudflare

Everything runs on one box (a Hetzner CX32 — 8GB / 4 vCPU / 80GB NVMe — is plenty
for a 100-player beta): the Next.js web app, the API + WebSocket server, and
PostgreSQL. Cloudflare fronts both hostnames via a tunnel — no open ports.

```
Browser ──▶ Cloudflare ──▶ cloudflared tunnel ──▶ VPS
                                 ├─ yourdomain.com      → next start   (:3000)
                                 └─ api.yourdomain.com  → API + WS     (:4000)
                                                             └─ PostgreSQL (docker, 127.0.0.1:5434)
```

## 1. One-time VPS setup

```bash
# as root: create a user, install node 20 + docker + git
adduser cookout && usermod -aG docker cookout
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git
curl -fsSL https://get.docker.com | sh

su - cookout
git clone https://github.com/theyachtsman/cookout && cd cookout
npm install
npm run build -w @cookout/shared
npm run build -w @cookout/web        # production bundle for next start
docker compose up -d                 # PostgreSQL on 127.0.0.1:5434
```

## 2. Environment

Create `/home/cookout/cookout.env`:

```bash
ADMIN_KEY=<openssl rand -hex 24>
DATABASE_URL=postgres://cookout:cookout@127.0.0.1:5434/cookout
CORS_ORIGIN=https://yourdomain.com
SEED=1                # demo auto-scheduler on; flip auto-schedule in /admin Live Ops
# BETA_WHITELIST=1    # uncomment when the beta window opens, restart the API
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

`NEXT_PUBLIC_API_URL` is baked into the web bundle — **rebuild the web app after
changing it**: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run build -w @cookout/web`.

## 3. systemd units

`/etc/systemd/system/cookout-api.service`:

```ini
[Unit]
Description=Cookout API
After=network.target docker.service
[Service]
User=cookout
WorkingDirectory=/home/cookout/cookout/apps/server
EnvironmentFile=/home/cookout/cookout.env
ExecStart=/usr/bin/node --import tsx src/index.ts
Restart=always
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/cookout-web.service`:

```ini
[Unit]
Description=Cookout Web
After=network.target
[Service]
User=cookout
WorkingDirectory=/home/cookout/cookout/apps/web
EnvironmentFile=/home/cookout/cookout.env
ExecStart=/usr/bin/node ../../node_modules/next/dist/bin/next start -p 3000
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now cookout-api cookout-web
```

Sessions survive restarts (persisted with the store), so deploys don't sign
anyone out.

## 4. Cloudflare tunnel (both hostnames)

```bash
cloudflared tunnel create cookout
cloudflared tunnel route dns cookout yourdomain.com
cloudflared tunnel route dns cookout api.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: cookout
credentials-file: /home/cookout/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:4000
  - hostname: yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Run it as a service: `cloudflared service install`. WebSockets pass through by
default (`wss://api.yourdomain.com/ws`).

## 5. Deploying updates

```bash
cd ~/cookout && git pull
npm install
npm run build -w @cookout/shared
NEXT_PUBLIC_API_URL=https://api.yourdomain.com npm run build -w @cookout/web
sudo systemctl restart cookout-api cookout-web
```

## 6. Backups

Postgres holds everything durable. Nightly dump via cron:

```bash
0 4 * * * docker exec cookout-postgres pg_dump -U cookout cookout | gzip > /home/cookout/backups/cookout-$(date +\%F).sql.gz
```

## Rate limits (built in, per IP, Cloudflare-aware)

Global 300 req/10s · auth 20/min · beta signup 6/hour · concept submissions
6/hour · trades 40/10s · feedback 4/min · chat 1 msg/800ms per connection.

## Crowd testing

```bash
node apps/server/scripts/bots.mjs https://api.yourdomain.com 50
```

Run the swarm against the real domain before announcing — it exercises the
tunnel, TLS, WS, and Postgres exactly like the crowd will. See
[BETA-RUNBOOK.md](BETA-RUNBOOK.md) for the beta-day playbook.
