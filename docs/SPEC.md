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

## 18. The Pit (bonus game mode — PvE vs Swarm AI)

The Pit is a complementary game mode that lives alongside the main Cookout PvP
experience. It is a new **Cookout match type**, not a separate app: it reuses the
same auth, wallet, Cook Out balance, Grill chat, profiles, notifications,
leaderboards, ledger, charts, and design system. Players compete against **The
Swarm** (Swarm AI) instead of each other.

- **Match type.** Every match carries `matchType` (`cookout` | `pit`). Pit rounds
  set `round.pit` (durations, fees, fee split, starting stack, both pool states).
  Legacy/Cookout matches leave it unset and behave exactly as before.
- **Direct launch, no vote.** Launch a Coin gains a Game Type selector. Picking
  The Pit shows a duration (⚡ Blitz 1m / 🔥 Standard 5m / 🧠 Marathon 10m) and
  launches straight into the Pit queue — no community vote.
- **Lifecycle.** Launch → Queue (deposits accepted) → Live (equal paper stacks vs
  the Swarm) → Results → Archive. No Fair Open auction and no separate lobby: a new
  match drops straight into the queue for deposits. It holds there up to a deposit
  window (`queueMaxSeconds`, default 10 min); if quorum is never met it is
  **cancelled** and every deposit refunded. Once each enabled pool has two bets, a
  short arm countdown (`lobbySeconds`, default 60s) runs and it goes live. Max 5
  concurrent live matches (configurable); extras hold in the queue until a slot frees.
- **Two independent pools.** Prediction (call Graduate / Rug / Timer) and Trading
  (trade a fixed paper stack; positive PnL qualifies). Each splits evenly among
  its winners; an unclaimed pool carries into the next match. Winning both is a
  Double Winner. Entry fees debit the Cook Out balance; the Pit fee is skimmed and
  routed (platform / weekly jackpot / creator / treasury).
- **Swarm AI Director.** Enhances the existing bot swarm to drive believable market
  stories (accumulation, momentum, fake recovery, panic, distribution, blow-off,
  late rug, recovery) scaled by duration and the admin Aggression / Difficulty
  knobs. It never predetermines winners. It is **always on for Pit rounds** — the
  admin Cookout bot toggle governs the Cookout swarm only.
- **Everywhere it shows up.** Cook Out balance ledger (`pit_*` entries), a Grill
  chat room per match with Swarm system messages, a profile **The Pit** tab
  (lifetime record + recent matches), and Pit leaderboards (Highest Profit,
  Prediction Accuracy, Prediction/Trading Wins, Double Wins, Largest Win, Profit
  Streak, Total Earnings, Best Blitz/Standard/Marathon). All gameplay values are
  admin-configurable (see §14).
- **Money.** Paper-only (no chain). The paper deployment denominates in pETH; the
  dev/testnet deployment labels entry fees in testnet ETH via the existing
  denomination handling. Trading never touches real liquidity.
- **Selectable modes.** A Pit match runs any combination of three modes, chosen at
  launch and preserved on Run It Back: **Prediction Market**, **Battle the Flame
  Goon Squad** (the Trading pool), and **Flame Trial** (below). Each mode keeps its
  own participants, results and stats over the shared Pit event.

### 18.1 Flame Trial (single-player PvE)

Flame Trial is a strictly **solo** mode: one player, the match creator, runs the
coin alone against the Flame Goon Squad AI. It reuses the Battle trading engine,
charts, order execution, portfolio, PnL, market sim and timers unchanged — the only
difference is the win condition and the reward model.

- **Single-player, creator-only.** Min 1, max 1. Only the wallet that launched the
  Pit coin can play the Trial; the server rejects any other wallet's trial stake and
  the lobby hides the entry for non-creators. If the Prediction Market is also
  enabled on the round, everyone else can still bet that side-pool on the creator's
  outcome — they just can't play the Trial.
- **Pairs with Prediction only.** Flame Trial and Battle the Flame Goon Squad are
  mutually exclusive (a solo run can't share the trading pool). The launch, Run It
  Back and both mode selectors block the combination, and the server rejects it.
- **Quick solo start.** The creator's single stake arms a short countdown
  (`trialLobbySeconds`, default 15s, admin-configurable) straight to live. The
  Trial drives its own clock — it never waits on the prediction side-pool.
- **Objective win condition.** Pass by finishing at or above a required final PnL.
  The bar is set by the tier the stake buys, not a flat number: a bigger stake means
  a higher bar. The architecture leaves room for future objectives (survive a
  duration, cap drawdown, trade count, volume, consistency); only Final PnL ships now.
- **Stake the coin.** Entry is a stake, not a pool buy-in: min $5 USD-equivalent
  from the Cook Out balance (admin min/max/tiers). **Pass and the stake comes back in
  full, plus the tier's rewards; miss the bar and the stake is forfeited to the
  house.** It is never a way to profit the Cook Out Balance — best case is
  break-even on balance plus progression. The **creator earns no fee** from a solo
  Trial (they are the player); a forfeited stake routes to jackpot + platform +
  treasury with the creator share folded into the house.
- **Stake tiers (configurable).** Each tier sets both its PnL bar and its reward
  weight. Defaults: Recruit $5 / +20%, Henchman $10 / +30%, Elite $25 / +45%,
  Legend $50 / +60%, Mythic $100 / +100%. Higher tier = higher bar, more XP, rarer
  cosmetics.
- **Rewards are progression only.** XP, Titles, Badges, Achievements
  (`first_flame`, `heat_resistant`, `fireproof`, `untouchable`, `legend_hunter`),
  daily/weekly quests, cosmetic unlocks (earned via achievements, never random
  drops), and Trial leaderboards (Wins / XP / Streak / PnL). No prize pool, no payout
  multiplier, no Cook Out Balance profit.

## 19. Burger economy ($BURG) — second progression currency

$BURG (displayed 🍔 $BURG) is a **permanent account currency** and a second
progression layer beside XP: XP measures progression, Burgers are **earned
purchasing power** toward future Recruit Crates and the Flame Goon Squad
collection. It is stored independently of XP, Cook Out balance, jackpot, and
wallet balances, and never expires. It is a **long-term retention mechanic**, not
a gameplay reward — front-loaded onboarding that eases into a steady, sustainable
pace via milestone spacing (no hard caps).

The whole economy is **data-driven**: every reward amount, cooldown,
repeatability, seasonal window, XP-level ladder, one-time milestone, and revenue
split lives in admin settings (`OpsSettings.burger`) and is editable live from the
**Burger Economy Manager** with no code change. Gameplay code never hardcodes a
reward value — systems call the award service (`apps/server/src/burger.ts`).

- **Earn sources (configurable rules).** Match completion (participating until the
  round ends — never trading, volume, or fees), Daily/Weekly quest completion, coin
  launch, coin graduation, referral, XP-level milestones (Lv 2/5/10/20/30/50…), and
  one-time firsts (First Match/Launch/Graduation/Daily/Weekly/Referral/Collection).
  **Placeholder hooks** ship disabled for Pit, Collection, Loot Box, Season Pass,
  Marketplace, and NFT rewards — future systems call the same service.
- **Never rewarded.** Trade count, trade volume, trading fees paid, wallet size, or
  portfolio value — to avoid wash-trading and unhealthy incentives.
- **Purchasing (no spending yet).** Players buy $BURG with Cook Out balance at a
  configurable rate (`burgersPerEth`). Spending sinks (Recruit Crates, etc.) come in
  later phases; the balance and hooks exist now.
- **Revenue allocation.** Each purchase is split by a configurable allocation across
  Weekly Jackpot, Coin Creator Rewards, Referral Rewards, Pit Prize Pools, and House
  Revenue, and every slice is written to a revenue ledger for future accounting
  dashboards. Only the jackpot slice has a live sink today (it feeds the weekly pot);
  the rest accrue into named buckets pending their systems. New destinations are easy
  to add.
- **Feedback.** Every award fires an animated 🍔 toast (slide-in, count-up, chime,
  queued, never interrupting gameplay) and the balance — always shown beside the Cook
  Out balance — counts up with a glow/pulse. A full Burger transaction history
  (source, amount, running balance, category, reference) lives in the wallet.
- **Analytics.** The manager surfaces economy health: total earned/purchased,
  circulating, holders, average per player, earned per day, sink ratio (purchased ÷
  earned), top sources, and top earners.
- **Admin.** Enable/disable, purchase rate, per-source rules, XP-milestone ladder,
  one-time milestones, revenue split, manual grant/remove, and analytics — all live.

## 20. The Flame Goon Squad (Pit AI personalities)

The Pit is inhabited by the **Flame Goon Squad** — named System AI Accounts that
live only inside The Pit and exist to build atmosphere, drama, and lore. They are
**not** the Cookout trading bots (0xb07…): they never trade, never earn, and never
appear in The Grill, the queue/lobby, or standard Cookout rounds. The players are
the stars; the Squad amplifies memorable moments and never dominates chat.

- **Roster.** Legendary/epic named characters (Ghost, Reaper, Legend, Rat, Proxy,
  Static, Oracle, Flame, Cipher, Titan, Nightfang, Specter, Volt, Ash) plus
  ambient Henchmen. Each is a real, profile-backed account (0x900d… address,
  /profile/<handle>) with an AI badge + persona bio/catchphrase/rivals on its page.
- **Personalities (data-driven).** Every persona has editable knobs (chattiness,
  aggression, confidence, optimism, sarcasm, humor), a schedule, rivalries,
  favorite topics, and **weighted dialogue pools** per category. No LLM — curated
  lines with anti-repeat tracking + {player}/{winner}/{rival}/{symbol}/{streak}
  token substitution from live events and continuity memory.
- **Event-driven, never timed.** Gameplay reports Pit moments (match created, live,
  whale/big-sell/rug/leader-change from the killfeed, final minute, winner, upset);
  the backend decides whether/who reacts. Named legends speak rarely; henchmen
  provide ambient life. Players first: a recent human message suppresses the Squad,
  a per-room cooldown gates frequency, and at most two AI lines fire per event.
- **Cinematic overlays.** Marquee beats occasionally fire a banner ("🔥 GHOST
  ENTERED THE PIT", "👑 {winner} TAKES THE PIT", "👁 PROXY IS WATCHING"), rarity-
  tinted and sparse.
- **Memory + rivalries.** Recent winners, per-name streaks, and the last upset
  persist and feed dialogue; personas occasionally reference their rivals.
- **Rotating presence.** Schedules (always / random / weekend / tournament /
  manual) mean not everyone appears every day, creating anticipation.
- **Admin AI Swarm Manager.** Global behavior knobs + a per-persona editor
  (identity, rarity, schedule, personality sliders, rivalries, avatar URL, and the
  weighted dialogue pools) with a live dialogue Preview. Everything editable with
  no code change. Extensible for future tournaments, seasons, and live events.
