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
SIWE_DOMAIN=yourdomain.com          # domain shown in (and bound to) the sign-in message
SIWE_URI=https://yourdomain.com     # defaults to http://$SIWE_DOMAIN if unset
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

## The chain operator key

`CHAIN_OPERATOR_KEY` pays gas for `createRound`, `settle`, and `resolve`. It is
the only key the platform holds, and it never custodies player funds — money
flows between players and the per-round contracts, never through us. But it is
a hot key on a live server, and the failure that matters is not theft:

**An empty operator cannot settle or resolve.** Settlement is permissionless,
so anyone *can* fire it, but nobody else has a reason to. Escrow that isn't
settled is escrow that can't be claimed or refunded, so an operator that runs
dry strands player money until it is topped up.

Policy for mainnet:

- **Fund it small and top it up often.** It needs gas, not a treasury. Anything
  beyond a few weeks of gas is just theft surface.
- **It is not the fee recipient.** Round fees go to the configured
  `feeRecipient`, and graduated-pool fees to a `FeeSplitter` — neither is the
  operator. Compromise of this key must not reach revenue.
- **Rotate on any suspicion, and on staff changes.** Rotation is a config
  change plus a restart: rounds already deployed are unaffected, because the
  factory grants no post-deploy rights over them.
- **Never reuse the testnet key.** The Robinhood testnet deployer is
  throwaway and its key is public.

The Command Center dashboard shows the operator's live balance and flags it
below `OPERATOR_MIN_BALANCE_ETH` (0.05 ETH). Crossing that floor also writes
one line to the audit log — the crossing, not the state, so a low balance
doesn't spam it once a minute.

## Mainnet (Robinhood Chain, 4663)

```
RPC       https://rpc.mainnet.chain.robinhood.com
chainId   4663
explorer  https://robinhoodchain.blockscout.com
```

Uniswap v4 is live there at the **same addresses as the testnet**, which is why
everything tested on 46630 transfers directly:

```
PoolManager      0x8366a39cc670b4001a1121b8f6a443a643e40951
PositionManager  0x58daec3116aae6d93017baaea7749052e8a04fa7
Permit2          0x000000000022D473030F116dDEE9F6B43aC78BA3
StateView        0xf3334192d15450cdd385c8b70e03f9a6bd9e673b
```

### Before you deploy

Everything below is cheap now and impossible later. The factory is immutable
once deployed, and a round created against a wrong PositionManager or a wrong
fee wallet can only be abandoned, never corrected.

1. **Generate a fresh operator key.** Not the testnet one — its private key is
   public, and anyone holding it can drain gas and stop settlement. Generate it
   somewhere the key never touches a shell history or a repo.
2. **Fund it small.** It pays gas for `createRound`, `settle`, `resolve`, and
   `migrate` — nothing else. A few weeks of gas. Anything more is theft surface.
3. **Keep it away from revenue.** `PROTOCOL_FEE_WALLET` and round fee recipients
   must be different addresses, so a compromised operator reaches no money.
4. **Run preflight, and read every line:**
   ```bash
   DEPLOYER_KEY=0x… node scripts/hh.cjs run scripts/preflight.cjs --network robinhood
   ```
   It refuses to pass on a missing or public key, an underfunded deployer, an
   absent v4 contract, a bad fee split, or an oversized factory.

### Deploy

```bash
DEPLOYER_KEY=0x… \
PROTOCOL_FEE_WALLET=0x… \
PROTOCOL_FEE_BPS=3000 \
node scripts/hh.cjs run scripts/deploy.cjs --network robinhood
```

Deploys PriceMath (linked library), LockerFactory, and RoundFactory, and writes
`contracts/deployments/robinhood.json`.

### Then, in order

1. Set `CHAIN_RPC`, `CHAIN_ID=4663`, `CHAIN_FACTORY`, `CHAIN_OPERATOR_KEY` in
   the API's env, and restart it.
2. **Turn the compliance gate on** — it ships off, so on real funds it is off
   until someone sets `enabled: true` in Command Center → Compliance. Set the
   blocked regions and confirm the terms version before the first player
   arrives, not after.
3. Run one small round end to end before announcing anything:
   ```bash
   DEPLOYER_KEY=0x… node scripts/hh.cjs run scripts/lifecycle.cjs --network robinhood
   ```
   It creates, settles, trades, resolves, graduates, migrates, and verifies the
   position is locked. On mainnet it costs real ETH — use the smallest seed the
   tier config allows.

### What does not carry over

Rounds on the testnet factory, and rounds on the **old** testnet factory
(`0xE52A…7E6E`, pre-migration), stay where they are. Nothing migrates between
deployments, and the old factory's rounds can never migrate at all.
