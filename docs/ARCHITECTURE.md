# Architecture (Phase 1)

## Data flow

```
Next.js app  ──REST──▶  Express routes ──▶ RoundEngine ──▶ Store (in-memory)
     ▲                                        │
     └────────────WebSocket Hub ◀── broadcast─┘
```

- **`packages/shared`** is the single source of truth for game math. `settleAuction`
  is a pure function of `(intents, pool, maxRaise, feeBps)` producing a deterministic
  audit hash (dependency-free SHA-256), so any client can recompute a settlement.
- **`RoundEngine`** (`apps/server/src/engine.ts`) owns the round state machine:
  `scheduled → lobby → queue_open → settling → live → ended → results`. All methods
  take `now` explicitly; the tick loop calls `tick(Date.now())` once per second. Tests
  drive the same engine with a fake clock.
- **End triggers**: timer expiry, rug detection (creator dump ≥50% of holdings, or
  pool draining ≥60% within 30s), liquidity removed (admin paper-mode simulator),
  market-cap target, low volume for a configured window, admin end.
- **Resolution**: graduation (criteria met → holders keep tokens, concept becomes
  "launched"/Arena Alumni) or uniform batch redemption — every remaining holder exits
  at one price `E·O/(T+O)` pro-rata, so resolution has no exit-order advantage either.
- **Gamification** (`gamification.ts`) runs once at round end: summary superlatives,
  XP awards, achievement grants, Moon-or-Rug resolution (XP only), creator fee share +
  reputation, single-tier referral credit.
- **Hub** (`ws.ts`): per-round channels; spectating needs no auth, chat needs a session.
- **Store** (`store.ts`): all state behind one class. Live-round data is inherently
  ephemeral (Redis-shaped); users/concepts/archives get a PostgreSQL adapter behind
  the same interface before Phase 2. Nothing outside `store.ts` knows how data is kept.

## Auth

Nonce → `personal_sign` → verify (viem) → bearer token. The web app uses the injected
wallet when available, else a local burner key. The server never sees a private key
and there are no deposits in Phase 1.

## Deliberate Phase-1 simplifications

| Simplification | Where the seam is |
| --- | --- |
| Hot state in memory; durable subset persisted via `Persistence` (PostgreSQL JSONB-per-entity, or atomic file snapshot) | `persistence.ts` + `Store.snapshot()/hydrate()` |
| Simulated AMM instead of on-chain pool | `packages/shared/src/amm.ts` mirrors x·y=k exactly |
| Burner-key fallback instead of WalletConnect | `lib/session.tsx` `signIn()` |
| Graduated tokens freeze post-round | Phase 3 permanent-pool trading |
| Single-process engine | engine is event-driven via `Broadcast`; horizontal scale = move Store to Postgres/Redis and shard rounds |

No whole-chain launch indexers are needed (spec §15): the platform controls deployment,
so launch detection is an internal trigger.

## The Pit (spec §18)

The Pit is a PvE match type layered onto the same `Round` and `RoundEngine`, not a
parallel system. A `matchType` discriminator (`cookout` | `pit`) flows through the
whole stack; only code that behaves differently branches on it.

| Concern | Where it lives |
| --- | --- |
| Types (`PitConfig`, `PitEntry`, `PitResult`, `PitStats`, `PIT_DURATIONS`, ledger kinds) | `packages/shared/src/{types,constants}.ts` |
| Lifecycle: `schedulePitRound`, lobby→live (no auction), per-match paper stack in `trade()`, `endRound`→`resolvePitRound` | `apps/server/src/engine.ts` |
| Entry-fee intake + Pit-fee routing | `apps/server/src/pit-pools.ts` |
| End resolution: pool splits, carryover, stats, XP | `apps/server/src/pit-results.ts` |
| Swarm AI Director (narrative market phases) | `apps/server/src/swarm-director.ts`, ticked from `index.ts`, always on for Pit rounds |
| Durable state: `pitStats` on the user, `pitCarry`, `settings.pit` | `apps/server/src/store.ts` (`snapshot()/hydrate()`) |
| Ephemeral per-match state: `pitEntries`, `pitStacks` | `Store` maps (not persisted, like live rounds) |
| Routes: `/api/pit`, `/api/pit/launch`, `/api/pit/:id/enter|me`, `/api/pit/history/:addr`, leaderboard `scope=pit` | `apps/server/src/routes.ts` |
| Web: `/pit`, `/pit/[id]` (lobby + live + results), profile The Pit tab, admin Pit panel | `apps/web/app/pit/*`, `components/Pit*.tsx` |

Reuse over duplication: trading is the same `engine.trade()` path (Pit buys/sells
draw down a per-match paper stack instead of the Cook Out balance and skip the
buy/sell ledger); the chart, order book, graduation progress, chat rooms, ledger,
and presence are the existing components. The `/round/:id` page redirects Pit
rounds to `/pit/:id` so ledger and results links keep working.

**Modes.** A Pit match runs any combination of three modes chosen at launch
(`concept.pitModes = { prediction, trading, trial }`) and preserved on Run It Back:
Prediction Market, Battle the Flame Goon Squad (the Trading pool), and Flame Trial.

**Flame Trial (single-player, spec §18.1).** A solo PvE mode reusing the Battle
trading engine; only the win condition and reward model differ. Key points for
future work:

- Trial and Trading are mutually exclusive (enforced in `routes.ts` launch +
  runback and in both web selectors). Trial pairs with Prediction only.
- Creator-only: `POST /api/pit/:id/enter` 403s a non-creator trial stake; the lobby
  hides the entry for non-creators (`LobbyView` gates on `me === creatorAddress`).
- `armPitLobby` special-cases trial rounds — the creator's single stake arms a quick
  countdown (`PitConfig.trialLobbySeconds`) straight to live, ignoring the prediction
  side-pool quorum.
- Economics (`pit-results.ts`): the stake is escrowed, not pooled. On a pass it is
  **refunded in full** (`pit_trial` credit) and the tier XP/achievements are granted;
  on a miss it is **forfeited** via `routeHouse()` (jackpot + platform + treasury, no
  creator cut). `routeHouse` exists precisely so the creator never earns from their
  own solo run. Player `net` is zero on a pass, `-stake` on a miss.
- The PnL bar is the **tier's** `requiredPnlBps`, chosen by stake size
  (`trialTierFor`), not a flat round value — bigger stake, higher bar, bigger reward.
  `PitConfig.trialRequiredPnlBps` is only the base/fallback; per-player and summary
  results carry `trialRequiredBps` for display.
