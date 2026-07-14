# Robinhood Launch Arena — Master Build Spec

The Cookout is built to this spec. Build in phase order — do not build Phase 2/3
systems before Phase 1 works end to end.

## 1. Branding & Naming

- **Product name:** The Cookout
- **Setting/world branding:** "Hood" — the world the platform is set in, used in
  marketing and light flavor copy only. Not paired with "Robinhood" branding; the
  product's identity stays independent of that trademark.
- **Signature phrases (flavor only, use sparingly):**
  - **"Pull Up"** — the join/enter-round CTA label.
  - **"Cooking"** — optional flavor label for a high-volume round, shown *alongside*
    real volume/market-cap numbers, never replacing them.
  - **"Burnt"** — optional kill-feed flavor for a rug event; underlying data still
    records "rug detected" / "liquidity removed".
- Everything else stays in plain trading/gaming language. These three phrases are the
  full extent of the theme.

## 2. Product Summary

Every round ("match") is a real token, created for that match by a community-submitted,
platform-vetted creator, opened through a fair batch auction (not FCFS), then traded
live in a synchronized, spectator-friendly arena until the round ends (rug, timer, or
graduation). Twitch meets a trading terminal — not a standard DEX frontend, and
explicitly **not** a simulated/RNG price-action game: every price move comes from real
trades against a real contract (Phase 1: real player trades against the simulated
paper pool).

### Non-negotiable design principles
- Fairness at the open must be real and verifiable, not just claimed.
- No pay-to-win. All monetization is cosmetic or fee-based.
- The platform never holds unilateral withdraw rights over round liquidity.
- Everything issuer-related (contracts, auction logic, settlement) is open-sourced.

## 3. Build Phases

**Phase 1 — Paper Money MVP:** full game loop, UI, social/gamification. No real funds.
Wallet-based auth (identity only), lobby, batch auction, live arena, kill feed/chat/
spectator, round resolution, XP/levels/achievements/cosmetics, leaderboards, creator
submission + voting (paper-funded liquidity).

**Phase 2 — Real Money, Limited Rollout:** real ETH, Rookie tier only, capped position
sizes, curated creators. Gated behind legal review (§12) — never self-authorized.

**Phase 3 — Full Launch:** all tiers, open creator economy, graduation-to-permanent-DEX,
full revenue model.

Build order within each phase: backend data model → auction/settlement contracts →
round engine → real-time layer → frontend arena → gamification → admin dashboard.

## 4. Core Gameplay Loop

Match calendar slot → teaser reveal → position queue opens → countdown → batch auction
settles (single uniform clearing price, one atomic transaction) → continuous live
trading (kill feed/chat/predictions active) → round ends on ANY of: liquidity removed,
rug detected, max timer, bond completed, migration event, mcap target exceeded, volume
below threshold for a configured duration → graduation check → results screen →
XP/achievements/leaderboard → next slot.

## 5. Launchpad & Creator Economy

- **Submission flow:** creator submits concept (name, symbol, artwork, theme, pitch) →
  community voting window → Arena Committee shortlists → winners scheduled → launch.
- **Vetting (required):** template-only deployment (creators supply metadata, never
  code); no creator mint/pause/blacklist; wallet history screened for rug flags;
  cooldown/reputation threshold before consecutive rounds.
- **Rewards:** capped revenue share of round trading fees; permanent "Launched by"
  credit; creator reputation score; top tiers unlock guaranteed slots, priority
  scheduling, creator cosmetics.
- **Creator profile:** submission history, rounds launched, performance, rating,
  revenue, reputation tier.

## 6. Fair Opening: Batch Auction (core differentiator)

Sequential AMM entry rewards fastest infra — "equal opportunity" would be false. A
uniform-price batch auction removes speed advantage at the open:

- Players submit buy intents (amount + optional max price).
- Queue closes at a fixed block/timestamp — not observable order arrival.
- All intents aggregate; one clearing price; ALL orders settle at that price in one
  atomic transaction; continuous trading starts from that price.
- **Oversubscription: pro-rata fill.** Never price-priority (reintroduces sniping),
  never first-N (reintroduces speed).
- Auction logic + clearing formula open-sourced and documented pre-round; every fill
  publicly auditable post-settlement.
- After the batch settles, continuous trading is a normal AMM market — fairness is
  engineered into the opening moment.

## 7. Risk-Tier Arenas

| Tier | Starting Liquidity | Curve | Unlock |
|---|---|---|---|
| Rookie | Deep | Gentle | Level 1 |
| Standard | Medium | Moderate | Level 10 |
| Degen | Thin | Steep / real rug risk | Level 35 |

Phase 2 real-money rollout starts with Rookie only.

## 8. Token Lifecycle & Graduation

Round ends → criteria met (mcap/volume/holders)? YES → liquidity migrates to a
permanent locked DEX pool, token keeps trading, holders keep positions, "Arena Alumni"
badge. NO → liquidity resolves per round-end rules; token ends.

## 9. Lobby, Arena UI, Social

- **Lobby:** countdown, player count, committed liquidity, average entry, spectators,
  chat. Join CTA label: **"Pull Up"** (only copy deviation; data labels stay literal).
- **Teaser reveal:** UX theater only — the batch auction does the fairness work.
- **Arena:** top bar (name/symbol, mcap, liquidity, volume, age, holders, PnL); live
  1-second-candle chart with event markers; Buy / Sell 25/50/75/All / custom.
- **Activity feed** (real-time trades), **kill feed** (CoD-style callouts), **chat**
  (emoji/GIF/stickers/moderation), **spectator mode** (exited players keep watching),
  **round-end summary** (winner, top profit, best trade, biggest whale, diamond hands,
  fastest exit, longest hold, average return, duration).

## 10. Gamification

- **XP** regardless of profit: win trade, first buy, longest hold, diamond hands,
  participation, perfect exit, big winner, whale hunter, Launched a Graduate,
  Community Pick, Degen Arena Survivor.
- **Levels 1–100, never reset:** Rookie → Ape → Sniper → Degen → Whale → Market Maker
  → Legend → Robinhood King. Levels gate risk tiers.
- **Achievements** (design for thousands): First Blood, Diamond Hands, Paper Hands,
  100X Club, Moon Rider, Rug Survivor, Whale Hunter, Perfect Exit, Comeback Kid,
  Lucky Bastard, …
- **Cosmetics only, never pay-to-win.**
- **Seasonal rankings** (monthly): profit, ROI, wins, streak, trades, XP, fastest buy,
  accuracy, creator board; top 100 get exclusive cosmetics.
- **Daily missions / weekly challenges.**
- **"Moon or Rug" predictions:** XP only — no financial payout without legal sign-off.

## 11. Accounts, Profiles, Leaderboards, Referrals

Wallet-based auth only (WalletConnect, Robinhood Chain). Optional display name/avatar.
Public profile: history, PnL, stats, referral code, achievements, XP/level, cosmetics,
creator reputation, season placements. Leaderboards: current match, today, weekly,
season, all-time. Referrals: single-tier only — no downline structures.

## 12. Compliance Flags (route to counsel before Phase 2)

- Issuer + market operator + game layer on one entity — review before real funds.
- The batch auction is wagering-adjacent despite the fairness framing.
- "Moon or Rug" is the highest-scrutiny system — XP-only unless cleared.
- Creator revenue share raises issuer-of-record questions — no real payouts pre-review.
- Referrals stay single-tier.
- Don't market paper mode as "practice for real trading" without review.

## 13. Trust & Fairness Requirements (day one)

No platform withdraw rights over round liquidity; liquidity locked/auto-migrated per
pre-published non-discretionary rules; templates + auction contracts open-sourced;
settlements publicly auditable; creator vetting leaves a public audit trail; emergency
pause is rate-limited and logged.

## 14. Admin Dashboard

Launch monitoring, round management, player management, wallet analytics, revenue,
referral tracking, blacklist/whitelist, live match controls, emergency pause
(rate-limited, logged), system health, fee config, XP balancing, achievement
management, plus launchpad curation tools, creator vetting dashboard, batch auction
monitor, graduation criteria configuration.

## 15. Technical Stack

Frontend: Next.js, React, TypeScript, TailwindCSS, Framer Motion, WebSockets.
Backend: Node.js, TypeScript, PostgreSQL, Redis, WebSocket server, event-driven,
queue workers. Blockchain: Robinhood Chain (EVM, Arbitrum L2), WalletConnect. No
whole-chain launch indexers needed — the platform controls deployment. New contracts:
audited token template, batch auction settlement, graduation/migration.
Infra: Docker, Kubernetes-ready, rate limiting, Cloudflare, monitoring.

## 16. Revenue Model

Trading fee, auction settlement fee, creator revenue share, premium analytics,
priority execution tier, Season Pass, referral share, sponsored tournaments, cosmetic
NFTs. No pay-to-win, ever.

## 17. Definition of Done — Phase 1

- [ ] Wallet connect + profile creation
- [ ] Creator submit → community vote → committee shortlist/schedule
- [ ] Lobby countdown + position queue
- [ ] Batch auction: single clearing price, pro-rata, auditable
- [ ] Live arena: chart, kill feed, activity feed, chat, spectator
- [ ] Round-end triggers: timer, rug detection, graduation
- [ ] Results, XP, achievements, leaderboards
- [ ] Admin: view/manage live round, logged pause

No Phase 2 work until §12 legal review is complete and §13 requirements are
independently verifiable.
