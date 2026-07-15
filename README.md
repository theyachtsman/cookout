# The Cookout

A live multiplayer trading arena that is its own token launchpad, targeting Robinhood
Chain (EVM, Arbitrum L2). Every match is a real token created for that match by a
community-vetted creator, opened through a **uniform-price batch auction** (not
first-come-first-served), traded live in a spectator-friendly arena, and resolved by
rug detection, timer, or graduation to a permanent pool.

**Current status: Phase 1 — paper money MVP.** Full game loop with simulated balances;
no real funds anywhere. Phases 2–3 (real funds) are gated behind legal review and
contract audits — see [docs/COMPLIANCE.md](docs/COMPLIANCE.md) and
[contracts/README.md](contracts/README.md).

## Why the batch auction is the core

Sequential AMM entry rewards whoever has the fastest infrastructure. The Cookout opens
every round with a batch auction instead:

- Buy intents queue until a **fixed close time** — arrival order is irrelevant.
- One **uniform clearing price** for every fill, computed as the fixed point
  `A* = min(D(p(A*)), maxRaise)` against the round's published curve.
- Oversubscription resolves **pro-rata** — never price-priority, never first-N.
- Settlement is atomic and emits a deterministic **audit hash** anyone can recompute
  from the published intents (`packages/shared/src/auction.ts` is dependency-free and
  runs in any JS environment).

## Workspace layout

```
packages/shared    types + pure game math: auction clearing, AMM curve, XP/levels,
                   achievements, tier configs (isomorphic, no Node dependencies)
apps/server        Node/TS: round engine (state machine, trades, rug detection,
                   graduation), wallet-signature auth, WebSocket hub, REST API,
                   gamification, admin controls
apps/web           Next.js arena: match calendar, lobby + position queue ("Pull Up"),
                   live chart/kill feed/chat/spectator, launchpad voting, leaderboards,
                   profile, admin dashboard
contracts          Phase-2 Solidity drafts (unaudited, unused in Phase 1)
docs               spec, architecture, compliance flags
```

## Run it

```bash
npm install
npm run build -w @cookout/shared   # build shared once (server + web import it)
npm run dev:server                 # API + WS on :4000 (ADMIN_KEY=dev-admin, SEED=1)
npm run dev:web                    # UI on :3000 (NEXT_PUBLIC_API_URL=http://localhost:4000)
```

Open http://localhost:3000. With seeding on, a demo round auto-schedules whenever the
calendar is empty.

**Persistence:** durable state (users, concepts, votes, archived rounds, settlements,
admin log) snapshots to `apps/server/data/state.json` by default. For PostgreSQL:

```bash
docker compose up -d   # cookout-postgres on 127.0.0.1:5434
DATABASE_URL=postgres://cookout:cookout@127.0.0.1:5434/cookout npm run dev:server
```

Live-round state is deliberately ephemeral either way — an in-flight round does not
survive a restart, archived results and player progression do. Connect Wallet uses the injected wallet if present, otherwise a
local burner key — either way auth is address + signature only (no deposits; Phase 1
balances are paper).

Admin dashboard: http://localhost:3000/admin (key: `dev-admin` by default). It can
shortlist/schedule submissions, pause/resume/end rounds (pause is rate-limited and
audit-logged), and simulate a liquidity pull to exercise rug handling.

Tests: `npm test` (shared auction/AMM math + full engine lifecycle: settle, trades,
rug, graduation, low-volume end, pause).

## Phase 1 definition of done (spec §17)

- [x] Wallet connect + profile creation
- [x] Creator submits concept; community votes; committee shortlists and schedules
- [x] Lobby countdown + position queue accepts intents
- [x] Batch auction settles at a single clearing price, pro-rata on oversubscription, auditable
- [x] Live arena: real-time chart, kill feed, activity feed, chat, spectator mode
- [x] Round-end triggers: timer, rug detection, graduation criteria (+ low-volume, mcap target)
- [x] Results screen, XP, achievements, leaderboard updates
- [x] Admin dashboard: manage a live round, pause it (logged, rate-limited)

Also implemented: daily missions + weekly challenges (XP-only rewards), a cosmetics
locker (badges/titles/chat colors/frames — unlocked by play, never purchasable,
rendered in chat and leaderboards), the "Cooking" hot-round flavor chip, and durable
persistence (PostgreSQL via `DATABASE_URL`, atomic file snapshot otherwise).

Known Phase-1 scope notes: WalletConnect proper, Redis-backed horizontal scaling, and
graduated-token post-round trading are Phase 2 items.

> Toolchain note: workspace scripts invoke local binaries via `node <path>` instead of
> relying on npm's PATH injection, because a repo path containing `:` (e.g. some USB
> mount points) breaks PATH-based bin resolution. This works everywhere.
