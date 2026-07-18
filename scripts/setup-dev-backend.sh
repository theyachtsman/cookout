#!/usr/bin/env bash
#
# Stand up the isolated dev/staging backend on agentbox, alongside the live beta.
#
# ADDITIVE ONLY — this never touches the live `cookout` database, the live API on
# :4000, or the existing tunnel hostnames. It creates a parallel API on :4001
# against a separate `cookout_dev` database, so dev/real-money work can't corrupt
# the beta community's data.
#
# Run it AS THE `agent` USER on 10.0.0.49:
#     bash ~/cookout-dev/scripts/setup-dev-backend.sh
# (or curl it / paste it). Safe to re-run — it updates the checkout and restarts
# the service. Your env file and its ADMIN_KEY are preserved across re-runs.
#
# After it succeeds, do the two off-box steps printed at the end (Cloudflare
# public hostname + Vercel NEXT_PUBLIC_API_URL).

set -euo pipefail

REPO="https://github.com/theyachtsman/cookout"
BRANCH="dev"
DIR="$HOME/cookout-dev"
ENV_FILE="$HOME/cookout-dev.env"
PORT=4001
DB="cookout_dev"
PG_CONTAINER="cookout-postgres"       # the existing live Postgres container
DEV_WALLET="0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1"

echo "==> 1/5  Create the dev database (idempotent, non-destructive)"
if docker exec "$PG_CONTAINER" psql -U cookout -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1; then
  echo "        ${DB} already exists — leaving it."
else
  docker exec "$PG_CONTAINER" psql -U cookout -c "CREATE DATABASE ${DB} OWNER cookout;"
  echo "        created ${DB}."
fi

echo "==> 2/5  Clone/update the dev checkout at ${DIR} (branch: ${BRANCH})"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" reset --hard "origin/${BRANCH}"
else
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi

echo "==> 3/5  Install deps + build shared package"
cd "$DIR"
npm install
npm run build -w @cookout/shared

echo "==> 4/5  Write ${ENV_FILE} (only if missing — preserves your ADMIN_KEY)"
if [ ! -f "$ENV_FILE" ]; then
  ADMIN_KEY="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<EOF
# --- Cookout dev/staging API (isolated from the live beta) ---
PORT=${PORT}
HOST=0.0.0.0
DATABASE_URL=postgres://cookout:cookout@127.0.0.1:5434/${DB}
CORS_ORIGIN=https://dev.thecookout.fun
SIWE_DOMAIN=dev.thecookout.fun
SIWE_URI=https://dev.thecookout.fun
SIWE_CHAIN_ID=1
ADMIN_KEY=${ADMIN_KEY}
DEV_WALLETS=${DEV_WALLET}
SEED=1
# Dev site sits behind HTTP Basic Auth, so the wallet whitelist is OFF here —
# any wallet can sign in and test. Flip to 1 to mirror the locked-down beta:
# BETA_WHITELIST=1
EOF
  chmod 600 "$ENV_FILE"
  echo "        wrote ${ENV_FILE}"
  echo "        >>> DEV ADMIN_KEY (save this): ${ADMIN_KEY}"
else
  echo "        ${ENV_FILE} already exists — leaving it untouched."
fi

echo "==> 5/5  Install + (re)start the systemd --user service on :${PORT}"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/cookout-api-dev.service" <<EOF
[Unit]
Description=Cookout API (dev/staging)
After=network.target

[Service]
WorkingDirectory=${DIR}/apps/server
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/env node --import tsx src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now cookout-api-dev
systemctl --user restart cookout-api-dev
sleep 2

echo
echo "---- service status ----"
systemctl --user --no-pager -l status cookout-api-dev | head -n 12 || true
echo
echo "---- local reachability (any HTTP code = listening) ----"
curl -sS -o /dev/null -w "  http://127.0.0.1:${PORT}/  ->  %{http_code}\n" "http://127.0.0.1:${PORT}/" || \
  echo "  (no response yet — check: journalctl --user -u cookout-api-dev -n 40)"

cat <<'NEXT'

============================================================
 Box work done. Two off-box steps remain:

 1) Cloudflare (Zero Trust > Networks > Tunnels > your tunnel
    > Public Hostname > Add):
       Subdomain: api-dev
       Domain:    thecookout.fun
       Service:   HTTP  ->  localhost:4001

 2) Vercel (Project > Settings > Environment Variables):
       NEXT_PUBLIC_API_URL
         Production = https://api.thecookout.fun     (unchanged)
         Preview    = https://api-dev.thecookout.fun (new)
    Then redeploy the dev branch (it's baked in at build time).

 Verify: https://api-dev.thecookout.fun should answer, and
 dev.thecookout.fun should talk to it (separate data from beta).
============================================================
NEXT
