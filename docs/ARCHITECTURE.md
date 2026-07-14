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
| In-memory store, no persistence across restarts | `Store` class boundary |
| Simulated AMM instead of on-chain pool | `packages/shared/src/amm.ts` mirrors x·y=k exactly |
| Burner-key fallback instead of WalletConnect | `lib/session.tsx` `signIn()` |
| Graduated tokens freeze post-round | Phase 3 permanent-pool trading |
| Single-process engine | engine is event-driven via `Broadcast`; horizontal scale = move Store to Postgres/Redis and shard rounds |

No whole-chain launch indexers are needed (spec §15): the platform controls deployment,
so launch detection is an internal trigger.
