import { randomUUID } from "node:crypto";
import {
  DEFAULT_ETH_USD,
  DAILY_SET_BONUS_XP,
  FLOOR_XP_WEEKLY_CAP,
  MILESTONES,
  SEASON_PASS_TIERS,
  STREAK_FREEZE_MAX,
  WEEKLY_MISSIONS,
  WEEKLY_SET_BONUS_XP,
  ACHIEVEMENTS,
  achievementXp,
  activeDailyMissions,
  dailyStreakReward,
  weeklyStreakReward,
  type Candle,
  FOUNDER_CAP,
  STARTING_PAPER_BALANCE,
  type TelegramLink,
  TRADE_XP,
  dayKey,
  levelForXp,
  titleForLevel,
  LEVEL_TITLES,
  weekKey,
  type EquippedCosmetics,
  type MissionMetric,
  type RoundHistoryEntry,
  type ActivityEvent,
  type ActivityKind,
  type Address,
  type GameMode,
  type ChainLedgerEntry,
  type LedgerEntry,
  type LedgerKind,
  type AuctionIntent,
  type AuctionResult,
  type ChatMessage,
  type PingEntry,
  type JackpotPayout,
  type KillFeedEvent,
  type Position,
  type Prediction,
  type RiskTier,
  type Round,
  type RugBan,
  type RoundSummary,
  type TokenConcept,
  type Trade,
  type UserProfile,
  type PitEntry,
  type PitStats,
  type PitBonusType,
  type PitDurationKey,
  type PitFeeSplit,
  type HouseSpecialKind,
  type TrialTier,
  type BurgerTxn,
  type BurgerSource,
  type BurgerRevenueEntry,
  type BurgerRevenueDest,
  type BurgerSettings,
  type GoonSettings,
  type GoonMoment,
  type AuditEntry,
  type AudioSettings,
  type BrandingSettings,
  type GameModeDef,
  type GameSettings,
  type MediaAsset,
  type ThemeSettings,
  type TelegramLogEntry,
  type TelegramSettings,
  type CollectionSettings,
  type PlayerCollection,
  freshTelegramSettings,
  mergeTelegramSettings,
  freshAudioSettings,
  freshBrandingSettings,
  freshThemeSettings,
  type MissionDef,
  type RoundConfig,
  type XpEventKind,
  GAME_MODE_MAP,
  TIER_CONFIGS,
  XP_AWARDS,
  freshGameSettings,
  mergeGameSettings,
  resolveMission,
  copyText,
  resolveCopy,
  flagEnabled,
  resolveFlags,
  PIT_DEFAULTS,
  BURGER_DEFAULTS,
  GOON_DEFAULTS,
  GOON_ROSTER,
} from "@cookout/shared";
import { awardBurger, awardBurgerOneTime, awardBurgerXpMilestones } from "./burger.js";
import { freshCollectionSettings, mergeCollectionSettings } from "./collection.js";
import type { StaffSession, StoredStaff } from "./staff.js";

/** The bot's command list, duplicated as plain data so the store can seed its
 *  Telegram settings without importing the bot (which would be a cycle). Kept
 *  in step with telegram/commands.ts by a test. */
export const TELEGRAM_COMMAND_DEFS = [
  { command: "pullup", description: "What's cooking right now" },
  { command: "profile", description: "Your stats" },
  { command: "leaderboard", description: "Who's cooking this week" },
  { command: "jackpot", description: "The weekly pot" },
  { command: "coin", description: "The coin on the grill" },
  { command: "creator", description: "Your launches & reputation" },
  { command: "founders", description: "Founding Members" },
];

/** Sessions outlive deploys but not this window (see snapshot comment). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRecord {
  address: Address;
  expiresAt: number;
}

export interface PendingNonce {
  nonce: string;
  issuedAt: number;
}

export interface BetaSignup {
  address: Address;
  xHandle?: string;
  at: number;
  approved: boolean;
}

export interface AdminLogEntry {
  id: string;
  at: number;
  action: string;
  detail: string;
}

export interface SeasonStats {
  pnl: number;
  xp: number;
  wins: number;
  trades: number;
}

/** A round-lifecycle moment for the community feed. */
export type RoundEventKind =
  | "submitted"
  | "scheduled"
  | "votes_hit"
  | "fair_open"
  | "live"
  | "burnt"
  | "results"
  | "run_it_back";
export interface RoundEvent {
  kind: RoundEventKind;
  /** For lifecycle events, the round id. For "submitted" (no round yet), the
   *  concept id — it deep-links the vote card. */
  roundId: string;
  symbol: string;
  /** The coin's game mode, so the community feed can name it. */
  mode?: GameMode;
  /** Vote count, for "votes_hit". */
  votes?: number;
  /** Coin name, for "submitted" (drives the shill post + prefilled tweet). */
  name?: string;
  /** Creator display name, for "submitted". */
  by?: string;
  /** "submitted" via Run It Back (a re-vote), not a brand-new coin — the shill
   *  post says it's running it back instead of the fresh-coin copy. */
  rerun?: boolean;
}

export interface StoredUser extends UserProfile {
  /** Wallets this player follows — drives their activity feed. */
  following?: Address[];
  /** The user's arena (burner session) wallet for on-chain rounds. Chain
   *  events from this address credit the owner's profile — XP, positions,
   *  quests — while the funds themselves stay in the burner on-chain. */
  arenaAddress?: string;
  /** Per-season (YYYY-MM) aggregates for seasonal leaderboards. */
  seasons: Record<string, SeasonStats>;
  /** XP earned per ISO week (key "2026-W29") — drives the weekly jackpot. */
  weeklyXp: Record<string, number>;
  /** XP earned per UTC day (dayKey), for the daily leaderboard. */
  dailyXp: Record<string, number>;
  /** Lifetime XP earned by source (trading, quests, achievements, pit, …), for
   *  the profile's "where your XP comes from" breakdown. */
  xpBySource?: Record<string, number>;
  /** Daily trade-XP accounting (Layer-1 grind cap): the day and XP so far. */
  tradeXpDayKey?: string;
  tradeXpToday?: number;
  /** Weekly "floor" XP accounting (anti-farm cap on grind sources). */
  floorXpWeekKey?: string;
  floorXpWeek?: number;
  /** Daily play streak (consecutive days with ≥1 round) + freeze tokens. */
  playStreak?: number;
  bestPlayStreak?: number;
  lastPlayDay?: string;
  streakFreezes?: number;
  /** Weekly-consistency streak (consecutive weeks clearing the weekly set). */
  weekStreak?: number;
  bestWeekStreak?: number;
  lastWeekSetKey?: string;
  feesEarned: number;
  /** Cook Out balance movements (stakes, redemptions, creator fees), newest
   *  last. The wallet's history ledger. */
  ledger?: LedgerEntry[];
  /** Cookout Wallet (on-chain) movements, newest last. Separate from `ledger`
   *  because it's real ETH rather than the paper Cook Out balance. */
  chainLedger?: ChainLedgerEntry[];
  /** Activity counters keyed by period ("2026-07-14" and "2026-W29"). */
  activity: Record<string, Partial<Record<MissionMetric, number>>>;
  /** Completed missions keyed "<periodKey>:<missionId>". */
  missionsDone: Record<string, true>;
  equipped: EquippedCosmetics;
  bestSeasonRank?: number;
  /** Recent round results, newest last (public trading history). */
  history: RoundHistoryEntry[];
  referralCount: number;
  referralEarnings: number;
  // ---- Burger economy ($BURG) — permanent, independent of every other balance.
  /** Current spendable Burger balance. */
  burgerBalance?: number;
  /** Burger transaction history (newest last), capped. */
  burgerLedger?: BurgerTxn[];
  /** Award bookkeeping: "once:<id>" / "xp:<level>" claim stamps and
   *  "cd:<source>" cooldown stamps, each an epoch-ms timestamp. */
  burgerClaims?: Record<string, number>;
  /** Lifetime Burgers earned (rewards only) — analytics + top earners. */
  burgerEarned?: number;
  /** Lifetime Burgers purchased. */
  burgerPurchased?: number;
  /** Lifetime Burgers spent (future spending sinks). */
  burgerSpent?: number;
  /** Flame Goon Squad Collection: owned dossiers, claimed sets, crates opened. */
  collection?: PlayerCollection;
}

/**
 * In-memory store for the Phase 1 paper MVP. Live-round state is inherently
 * hot/ephemeral (Redis-shaped); durable entities (users, concepts, archives)
 * get a PostgreSQL adapter behind this same interface before Phase 2.
 */
export class Store {
  users = new Map<Address, StoredUser>();
  sessions = new Map<string, SessionRecord>(); // token → session
  nonces = new Map<Address, PendingNonce>();
  concepts = new Map<string, TokenConcept>();
  conceptVoters = new Map<string, Set<Address>>();
  rounds = new Map<string, Round>();
  intents = new Map<string, AuctionIntent[]>(); // roundId → intents
  auctionResults = new Map<string, AuctionResult>();
  trades = new Map<string, Trade[]>(); // roundId → trades
  candles = new Map<string, Candle[]>(); // roundId → closed 1s candles
  positions = new Map<string, Map<Address, Position>>(); // roundId → address → position
  chat = new Map<string, ChatMessage[]>();
  killfeed = new Map<string, KillFeedEvent[]>();
  predictions = new Map<string, Map<Address, Prediction>>();
  summaries = new Map<string, RoundSummary>();
  // ---- The Pit (PvE vs Swarm AI) — ephemeral per-match state ----
  /** roundId → address → their lobby entry (prediction call and/or trading). */
  pitEntries = new Map<string, Map<Address, PitEntry>>();
  /** roundId → address → remaining paper stack (pETH) for Trading Pool players. */
  pitStacks = new Map<string, Map<Address, number>>();
  /** Unclaimed prize pools carried into the next Pit match (durable). */
  pitCarry: { prediction: number; trading: number } = { prediction: 0, trading: 0 };
  adminLog: AdminLogEntry[] = [];
  // ---- Command Center (internal ops platform) ----
  /** Staff accounts, keyed by id. Entirely separate from player wallets. */
  staff = new Map<string, StoredStaff>();
  /** Live staff sessions, keyed by opaque bearer token. Not persisted: a
   *  restart signs operators out, which is the safe default for an ops tool. */
  staffSessions = new Map<string, StaffSession>();
  /** The structured audit trail — every administrative action, newest last. */
  auditLog: AuditEntry[] = [];
  /** Feature-flag overrides. Sparse: anything absent uses the registry default. */
  featureFlags: Record<string, boolean> = {};
  /** Media Library metadata. The bytes live on disk (see MediaService). */
  media = new Map<string, MediaAsset>();
  /** Telegram delivery log — sends, failures, command usage. Newest last. */
  telegramLog: TelegramLogEntry[] = [];
  /** Platform fee revenue collected per round (paper ETH). */
  feesByRound = new Map<string, number>();
  /** Chat mutes/bans: address → muted-until epoch ms (persisted; a ban is a
   *  very long mute). */
  muted = new Map<Address, number>();
  /** Recent @-mention pings per player (in-memory, newest first, capped). */
  pings = new Map<Address, PingEntry[]>();
  /** Pre-launch beta signups: wallet → signup record (whitelist source). */
  betaSignups = new Map<Address, BetaSignup>();
  /** Tester feedback, wallet-attached (beta instrumentation). */
  feedback: FeedbackEntry[] = [];
  /** Live-ops settings, adjustable from the admin dashboard. */
  settings: OpsSettings = {
    autoSchedule: true,
    tier: "rookie",
    leadSeconds: 15,
    bots: true,
    announceTips: [
      "🍳 Want your own coin at the Cook Out? Menu → Launch a Coin: pick a name, ticker, and art, then the community votes it onto the calendar.",
      "🗳️ Vote on submitted coins from the Vote page. Top-voted concepts become the next matches.",
      "⚖️ New here? The Fair Open means nobody gets in before you: every buy settles at ONE price. Speed buys nothing.",
      "🎰 Every trade feeds the Weekly Jackpot. Top 10 by weekly XP split it every Monday.",
    ],
    announceEveryMin: 30,
    pinnedAnnouncement: "",
    // Paper beta default: a rug ban is a lesson, not a sentence — the player
    // clears it themselves from their profile. Flip OFF for real-money
    // deployments, where bans wait out the escalation schedule below.
    selfServeUnban: true,
    // Wait-out schedule in hours by offense count (1st, 2nd, 3rd+ rug).
    rugBanHours: [24, 72, 168],
    // The Pit economy + Swarm knobs, all live-editable. Deep-copied from the
    // shared defaults so admin edits never mutate the shared constant.
    pit: freshPitSettings(),
    // The Burger economy ($BURG), fully live-editable (see freshBurgerSettings).
    burger: freshBurgerSettings(),
    // The Flame Goon Squad AI — personalities + behavior, all live-editable.
    goons: freshGoonSettings(),
    game: freshGameSettings(),
    branding: freshBrandingSettings(),
    themes: freshThemeSettings(),
    audio: freshAudioSettings(),
    copy: {},
    telegram: freshTelegramSettings(TELEGRAM_COMMAND_DEFS),
    collection: freshCollectionSettings(),
  };
  /** Live ETH/USD, refreshed by the price feed; used to peg the $40k bond. */
  ethUsd = DEFAULT_ETH_USD;

  // ---- Weekly Jackpot ----
  /** Accrued pot for the week currently in progress (paper ETH). */
  jackpotPool = 0;
  /** The ISO week the pool is accruing for; a roll past this triggers payout. */
  jackpotWeekKey = weekKey();
  /** Settled weekly payouts, newest last. */
  jackpotHistory: JackpotPayout[] = [];
  /** Lifetime jackpot paid out (paper ETH) — headline stat. */
  jackpotLifetimeEth = 0;

  // ---- Weekly site totals (drive the jackpot page's "where it comes from") --
  /** Site-wide trading volume per ISO week (pETH). */
  weeklyVolume: Record<string, number> = {};
  /** Site-wide trading fees collected per ISO week (pETH). */
  weeklyFees: Record<string, number> = {};

  /** Accrue a finished round's volume + fees into this week's site totals. */
  accrueWeeklyTotals(volume: number, fees: number, now = Date.now()): void {
    const wk = weekKey(now);
    if (volume > 0) this.weeklyVolume[wk] = (this.weeklyVolume[wk] ?? 0) + volume;
    if (fees > 0) this.weeklyFees[wk] = (this.weeklyFees[wk] ?? 0) + fees;
  }

  // ---- Burger economy ($BURG) site-wide accounting -----------------------
  /** Purchase-revenue ledger: one line per allocation slice, newest last. */
  burgerRevenueLedger: BurgerRevenueEntry[] = [];
  /** Lifetime pETH routed to each revenue destination (cumulative accounting). */
  burgerRevenueBuckets: Record<BurgerRevenueDest, number> = {
    jackpot: 0,
    creator: 0,
    referral: 0,
    pit: 0,
    house: 0,
  };
  /** Lifetime purchase revenue routed (pETH) — headline stat. */
  burgerRevenueEth = 0;
  /** Site-wide Burgers earned by source (analytics). */
  burgerBySource: Partial<Record<BurgerSource, number>> = {};
  /** Site-wide Burgers earned per UTC day (dayKey → amount), for the daily chart. */
  burgerDaily: Record<string, number> = {};
  /** Set by the hub: streams a Burger award to the earner's live sockets. */
  onBurger: (
    address: Address,
    e: { amount: number; balance: number; source: BurgerSource; label: string },
  ) => void = () => {};

  /**
   * Record a Burger balance movement in the user's history (assumes the balance
   * is already updated). `amount` is signed. Fires the socket toast + rolls up
   * site-wide analytics for reward credits.
   */
  recordBurgerTxn(
    address: Address,
    entry: { source: BurgerSource; category: BurgerTxn["category"]; amount: number; label: string; ref?: string },
    now = Date.now(),
  ): void {
    if (entry.amount === 0) return;
    const u = this.getOrCreateUser(address);
    const list = (u.burgerLedger ??= []);
    list.push({
      id: this.id(),
      at: now,
      source: entry.source,
      category: entry.category,
      amount: entry.amount,
      balanceAfter: u.burgerBalance ?? 0,
      label: entry.label,
      ...(entry.ref ? { ref: entry.ref } : {}),
    });
    if (list.length > 300) list.splice(0, list.length - 300);
    // Site-wide analytics only count positive reward/grant credits as "earned".
    if (entry.category === "reward" && entry.amount > 0) {
      this.burgerBySource[entry.source] = (this.burgerBySource[entry.source] ?? 0) + entry.amount;
      const dk = dayKey(now);
      this.burgerDaily[dk] = (this.burgerDaily[dk] ?? 0) + entry.amount;
      // Keep the daily map bounded (~120 days).
      const days = Object.keys(this.burgerDaily);
      if (days.length > 140) for (const k of days.sort().slice(0, days.length - 120)) delete this.burgerDaily[k];
    }
    if (!address.startsWith("0xb07"))
      this.onBurger(u.address, { amount: entry.amount, balance: u.burgerBalance ?? 0, source: entry.source, label: entry.label });
  }

  // ---- Flame Goon Squad AI ----
  /** Reported Pit moments fan out to the Goon engine (wired in index.ts). The
   *  frontend never triggers dialogue; it only reports gameplay events. */
  onPitMoment: (m: GoonMoment) => void = () => {};
  /** Continuity memory so personalities feel persistent: recent winners, current
   *  win streaks by name, and the last upset. Persisted; pruned by memoryHours. */
  goonMemory: {
    recentWinners: { name: string; at: number }[];
    streaks: Record<string, number>;
    lastUpset?: { name: string; at: number };
  } = { recentWinners: [], streaks: {} };
  /** handle → account address, for /profile/<handle> resolution. */
  private goonHandleIndex = new Map<string, Address>();
  /** Look up a Goon account by its handle (case-insensitive). */
  goonByHandle(handle: string): StoredUser | undefined {
    const addr = this.goonHandleIndex.get(handle.toLowerCase());
    return addr ? this.users.get(addr) : undefined;
  }
  /** (Re)build the handle index from the current roster. Call after hydrate and
   *  whenever the Goon engine registers accounts. */
  indexGoon(handle: string, address: Address): void {
    this.goonHandleIndex.set(handle.toLowerCase(), address.toLowerCase() as Address);
  }

  /** arena (burner) wallet address → owner profile address. */
  private arenaIndex = new Map<string, Address>();

  /** Recent site-wide activity (newest last), capped. */
  activity: ActivityEvent[] = [];
  /** Set by the hub so activity streams to the global room live. */
  onActivity: (e: ActivityEvent) => void = () => {};
  /** Extra taps on the activity stream (e.g. The Pit Boss on Telegram). Unlike
   *  onActivity, any number can subscribe without clobbering each other. */
  private activityTaps: Array<(e: ActivityEvent) => void> = [];
  onActivityEvent(fn: (e: ActivityEvent) => void): void {
    this.activityTaps.push(fn);
  }

  /** Round-lifecycle events — the marquee moments the community feed cares
   *  about (a coin booked, the Fair Open, trading live, a burn, a run-it-back).
   *  A separate stream from `activity` because these are about rounds, not
   *  players, and the Telegram feed routes them to their own topics. */
  private roundTaps: Array<(e: RoundEvent) => void> = [];
  onRoundEvent(fn: (e: RoundEvent) => void): void {
    this.roundTaps.push(fn);
  }
  emitRoundEvent(e: RoundEvent): void {
    for (const tap of this.roundTaps) {
      try {
        tap(e);
      } catch {
        /* a bad tap must never break the round engine */
      }
    }
  }

  /** Record something the crowd should see. Bots are excluded by the caller. */
  pushActivity(
    address: Address,
    kind: ActivityKind,
    text: string,
    extra: { roundId?: string; roundSymbol?: string } = {},
  ): void {
    const u = this.users.get(address.toLowerCase());
    const event: ActivityEvent = {
      id: this.id(),
      kind,
      address: address.toLowerCase(),
      displayName: u?.displayName,
      avatarUrl: u?.avatarUrl,
      text,
      at: Date.now(),
      ...extra,
    };
    this.activity.push(event);
    if (this.activity.length > 300) this.activity.splice(0, this.activity.length - 300);
    this.onActivity(event);
    for (const tap of this.activityTaps) {
      try {
        tap(event);
      } catch {
        /* a bad tap must never break the activity fan-out */
      }
    }
  }

  /**
   * Record a Cook Out balance movement in the user's history ledger. Assumes
   * arenaBalance has already been updated, so it snapshots the running balance.
   * `amount` is signed (positive credit, negative debit).
   */
  recordLedger(
    address: Address,
    kind: LedgerKind,
    amount: number,
    opts: { symbol?: string; roundId?: string } = {},
  ): void {
    if (amount === 0) return;
    const u = this.getOrCreateUser(address);
    const list = (u.ledger ??= []);
    list.push({
      id: this.id(),
      at: Date.now(),
      kind,
      amount,
      balanceAfter: u.arenaBalance ?? 0,
      ...(opts.symbol ? { symbol: opts.symbol } : {}),
      ...(opts.roundId ? { roundId: opts.roundId } : {}),
    });
    if (list.length > 250) list.splice(0, list.length - 250);
  }

  /**
   * Record a Cookout Wallet movement mirrored from the chain.
   *
   * Deduped on transaction hash + kind: the mirror re-scans a block range after
   * a restart, and a player should not see the same buy twice. There's no
   * running balance here on purpose — the wallet's balance is whatever the
   * chain says, and inventing one from partial history would be a lie.
   */
  recordChainLedger(
    address: Address,
    entry: Omit<ChainLedgerEntry, "id" | "at"> & { at?: number },
  ): void {
    const u = this.getOrCreateUser(address);
    const list = (u.chainLedger ??= []);
    if (entry.txHash && list.some((e) => e.txHash === entry.txHash && e.kind === entry.kind)) return;
    list.push({ id: this.id(), at: entry.at ?? Date.now(), ...entry });
    if (list.length > 250) list.splice(0, list.length - 250);
  }

  /** Newest-first Cookout Wallet history for a player. */
  chainLedgerOf(address: Address): ChainLedgerEntry[] {
    return [...(this.users.get(address.toLowerCase() as Address)?.chainLedger ?? [])].reverse();
  }

  // ---- The Pit helpers ----
  /** A Trading Pool player's remaining paper stack for a match (pETH). */
  pitStackOf(roundId: string, address: Address): number {
    return this.pitStacks.get(roundId)?.get(address.toLowerCase()) ?? 0;
  }
  setPitStack(roundId: string, address: Address, value: number): void {
    let m = this.pitStacks.get(roundId);
    if (!m) {
      m = new Map();
      this.pitStacks.set(roundId, m);
    }
    m.set(address.toLowerCase(), Math.max(0, value));
  }
  addPitStack(roundId: string, address: Address, delta: number): void {
    this.setPitStack(roundId, address, this.pitStackOf(roundId, address) + delta);
  }
  pitEntriesFor(roundId: string): Map<Address, PitEntry> {
    let m = this.pitEntries.get(roundId);
    if (!m) {
      m = new Map();
      this.pitEntries.set(roundId, m);
    }
    return m;
  }
  pitEntryOf(roundId: string, address: Address): PitEntry | undefined {
    return this.pitEntries.get(roundId)?.get(address.toLowerCase());
  }
  setPitEntry(roundId: string, address: Address, entry: PitEntry): void {
    this.pitEntriesFor(roundId).set(address.toLowerCase(), entry);
  }
  /** Get (or lazily create) a player's lifetime Pit record. */
  pitStatsOf(address: Address): PitStats {
    const u = this.getOrCreateUser(address);
    if (!u.pitStats) u.pitStats = emptyPitStats();
    return u.pitStats;
  }

  /** Move paper money into the arena balance (what matches spend). */
  arenaDeposit(address: Address, amount: number): StoredUser {
    const u = this.getOrCreateUser(address);
    const amt = Math.min(Math.max(0, amount), u.paperBalance);
    if (amt <= 0) return u;
    u.paperBalance -= amt;
    u.arenaBalance = (u.arenaBalance ?? 0) + amt;
    this.recordLedger(address, "stake", amt);
    return u;
  }

  /** Pull it back out. Only what isn't currently escrowed in a queue. */
  arenaWithdraw(address: Address, amount: number): StoredUser {
    const u = this.getOrCreateUser(address);
    const amt = Math.min(Math.max(0, amount), u.arenaBalance ?? 0);
    if (amt <= 0) return u;
    u.arenaBalance = (u.arenaBalance ?? 0) - amt;
    u.paperBalance += amt;
    this.recordLedger(address, "unstake", -amt);
    return u;
  }

  /** Follow / unfollow. Returns the follower's current list. */
  setFollowing(follower: Address, target: Address, on: boolean): Address[] {
    const u = this.getOrCreateUser(follower);
    const t = target.toLowerCase();
    const list = new Set(u.following ?? []);
    if (t === u.address) return [...list]; // no self-follow
    if (on) list.add(t);
    else list.delete(t);
    u.following = [...list];
    return u.following;
  }

  // ---- Telegram companion linking ----------------------------------------

  /** telegram user id → owner profile address. Rebuilt on hydrate. */
  private telegramIndex = new Map<string, Address>();
  /** One-time link tokens (ephemeral, not persisted): token → address + expiry. */
  private tgLinkTokens = new Map<string, { address: Address; expiresAt: number }>();

  /** Mint a short-lived token the player carries into Telegram via deep link. */
  createTelegramLinkToken(address: Address, ttlMs = 15 * 60_000): string {
    // Prune expired tokens opportunistically so the map can't grow unbounded.
    const now = Date.now();
    for (const [k, v] of this.tgLinkTokens) if (v.expiresAt <= now) this.tgLinkTokens.delete(k);
    const token = randomUUID().replace(/-/g, "");
    this.tgLinkTokens.set(token, { address: address.toLowerCase(), expiresAt: now + ttlMs });
    return token;
  }

  /** Redeem a link token (single use). Returns the owner address or undefined. */
  consumeTelegramLinkToken(token: string): Address | undefined {
    const rec = this.tgLinkTokens.get(token);
    if (!rec) return undefined;
    this.tgLinkTokens.delete(token);
    if (rec.expiresAt <= Date.now()) return undefined;
    return rec.address;
  }

  /** Bind a Telegram account to a profile (one Telegram id per profile). */
  linkTelegram(address: Address, link: TelegramLink): StoredUser {
    const u = this.getOrCreateUser(address);
    // If this telegram id was linked elsewhere, release the old owner first.
    const prevOwner = this.telegramIndex.get(link.userId);
    if (prevOwner && prevOwner !== u.address) {
      const old = this.users.get(prevOwner);
      if (old) old.telegram = undefined;
    }
    if (u.telegram) this.telegramIndex.delete(u.telegram.userId);
    u.telegram = link;
    this.telegramIndex.set(link.userId, u.address);
    return u;
  }

  unlinkTelegram(address: Address): StoredUser {
    const u = this.getOrCreateUser(address);
    if (u.telegram) this.telegramIndex.delete(u.telegram.userId);
    u.telegram = undefined;
    return u;
  }

  /** Which profile owns a Telegram user id, if any. */
  resolveTelegram(userId: string): Address | undefined {
    return this.telegramIndex.get(userId);
  }

  /** Every linked user (for fan-out). */
  linkedTelegramUsers(): StoredUser[] {
    return [...this.telegramIndex.values()]
      .map((a) => this.users.get(a))
      .filter((u): u is StoredUser => !!u?.telegram);
  }

  private reindexTelegram(): void {
    this.telegramIndex.clear();
    for (const u of this.users.values())
      if (u.telegram) this.telegramIndex.set(u.telegram.userId, u.address);
  }

  // ---- Founding Members ---------------------------------------------------

  /** Claim a permanent founder number (idempotent). Undefined once the cap is
   *  reached and the wallet isn't already a founder. Numbers never repeat. */
  claimFounder(address: Address): number | undefined {
    const u = this.getOrCreateUser(address);
    if (u.founderNumber) return u.founderNumber;
    let max = 0;
    for (const x of this.users.values()) if (x.founderNumber && x.founderNumber > max) max = x.founderNumber;
    if (max >= FOUNDER_CAP) return undefined;
    u.founderNumber = max + 1;
    u.founderSince = Date.now();
    return u.founderNumber;
  }

  /** Founders in number order. */
  founders(): StoredUser[] {
    return [...this.users.values()]
      .filter((u) => u.founderNumber)
      .sort((a, b) => (a.founderNumber ?? 0) - (b.founderNumber ?? 0));
  }

  id(): string {
    return randomUUID();
  }

  /** Link a user's arena wallet; chain events from it credit the owner. */
  setArenaAddress(owner: Address, arena: string): void {
    const u = this.getOrCreateUser(owner);
    if (u.arenaAddress) this.arenaIndex.delete(u.arenaAddress);
    u.arenaAddress = arena.toLowerCase();
    this.arenaIndex.set(u.arenaAddress, u.address);
  }

  /** Resolve who a chain address belongs to (arena wallet → owner, else self). */
  resolveArenaOwner(address: string): Address {
    return this.arenaIndex.get(address.toLowerCase()) ?? (address.toLowerCase() as Address);
  }

  /** Rebuild the arena index (after hydrate). */
  reindexArena(): void {
    this.arenaIndex.clear();
    for (const u of this.users.values())
      if (u.arenaAddress) this.arenaIndex.set(u.arenaAddress, u.address);
  }

  seasonKey(now = Date.now()): string {
    const d = new Date(now);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  getOrCreateUser(address: Address, referredBy?: Address): StoredUser {
    const key = address.toLowerCase();
    let u = this.users.get(key);
    if (!u) {
      u = {
        address: key,
        xp: 0,
        level: 1,
        title: this.titleFor(1),
        paperBalance: STARTING_PAPER_BALANCE,
        // Nothing is playable until you move it into the arena.
        arenaBalance: 0,
        achievements: [],
        referralCode: key.slice(2, 8),
        referredBy,
        createdAt: Date.now(),
        creatorReputation: 0,
        seasons: {},
        weeklyXp: {},
        dailyXp: {},
        jackpotWinnings: 0,
        jackpotWins: [],
        feesEarned: 0,
        activity: {},
        missionsDone: {},
        equipped: {},
        history: [],
        referralCount: 0,
        referralEarnings: 0,
        stats: {
          roundsPlayed: 0,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnl: 0,
          bestTradePnl: 0,
          rugsSurvived: 0,
          predictionsCorrect: 0,
          predictionsMade: 0,
          currentWinStreak: 0,
          bestWinStreak: 0,
          // Endurance track — separate from timed matches. Optional on the
          // type so accounts stored before Endurance shipped still load.
          enduranceRounds: 0,
          enduranceBonds: 0,
          longestEnduranceHoldSeconds: 0,
        },
      };
      this.users.set(key, u);
    }
    return u;
  }

  userByReferralCode(code: string): StoredUser | undefined {
    for (const u of this.users.values()) if (u.referralCode === code) return u;
    return undefined;
  }

  /**
   * Award XP. `source` marks anti-farm category: "floor" XP (trade XP, daily
   * quests, participation) is subject to a weekly cap so grinding can't top the
   * jackpot board; "ceiling" XP (skill, competition, streaks, milestones) is
   * uncapped. Returns the user.
   */
  addXp(
    address: Address,
    amount: number,
    source: "floor" | "ceiling" = "ceiling",
    category = "other",
  ): StoredUser {
    const u = this.getOrCreateUser(address);
    let give = amount;
    if (source === "floor" && give > 0) {
      const wk = weekKey();
      if (u.floorXpWeekKey !== wk) {
        u.floorXpWeekKey = wk;
        u.floorXpWeek = 0;
      }
      give = Math.min(give, Math.max(0, FLOOR_XP_WEEKLY_CAP - (u.floorXpWeek ?? 0)));
      u.floorXpWeek = (u.floorXpWeek ?? 0) + give;
    }
    if (give <= 0) return u;
    const beforeLevel = u.level;
    u.xp += give;
    u.level = levelForXp(u.xp);
    u.title = this.titleFor(u.level);
    if (u.level > beforeLevel) {
      this.pushActivity(u.address, "level_up", `reached Level ${u.level} · ${u.title}`);
      // Burger economy: pay any newly-crossed XP-level milestones.
      awardBurgerXpMilestones(this, u.address, u.level);
    }
    const season = (u.seasons[this.seasonKey()] ??= { pnl: 0, xp: 0, wins: 0, trades: 0 });
    season.xp += give;
    const wk = weekKey();
    u.weeklyXp[wk] = (u.weeklyXp[wk] ?? 0) + give;
    const dk = dayKey();
    u.dailyXp[dk] = (u.dailyXp[dk] ?? 0) + give;
    // Where-your-XP-comes-from breakdown (profile Quests tab).
    (u.xpBySource ??= {})[category] = (u.xpBySource[category] ?? 0) + give;
    // Satisfying +XP drop-in: push to the earner's own sockets. Bots excluded.
    if (!u.address.startsWith("0xb07"))
      this.onXp(u.address, { amount: give, total: u.xp, level: u.level, source: category });
    return u;
  }

  /** Set by the hub: streams +XP events to the earner's live sockets. */
  onXp: (
    address: Address,
    e: { amount: number; total: number; level: number; source?: string },
  ) => void = () => {};

  grantAchievement(address: Address, id: string): boolean {
    const cfg = this.settings.game.achievements[id];
    // Switched off in the Command Center: it stops being awarded, and existing
    // holders keep theirs — revoking something already earned would be worse.
    if (cfg?.enabled === false) return false;
    const u = this.getOrCreateUser(address);
    if (u.achievements.includes(id)) return false;
    u.achievements.push(id);
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    const rarity = cfg?.rarity ?? def?.rarity;
    if (def) this.pushActivity(u.address, "achievement", `unlocked ${def.name} (${rarity})`);
    // One-time XP by rarity — turns the badge wall into a progression track.
    const xp = rarity ? this.settings.game.achievementXp[rarity] : achievementXp(id);
    if (xp > 0) this.addXp(address, xp, "ceiling", "achievements");
    return true;
  }

  /**
   * Award Layer-1 trade XP with a daily cap. Per-round decay is enforced by the
   * caller (engine); this bounds the daily grind total. Returns XP actually given.
   */
  awardTradeXp(address: Address, amount: number, now = Date.now()): number {
    if (amount <= 0) return 0;
    const u = this.getOrCreateUser(address);
    const dk = dayKey(now);
    if (u.tradeXpDayKey !== dk) {
      u.tradeXpDayKey = dk;
      u.tradeXpToday = 0;
    }
    const dailyCap = this.settings.game.tradeXp.dailyCap;
    const give = Math.min(amount, Math.max(0, dailyCap - (u.tradeXpToday ?? 0)));
    if (give > 0) {
      u.tradeXpToday = (u.tradeXpToday ?? 0) + give;
      this.addXp(address, give, "floor", "trading");
    }
    return give;
  }

  position(roundId: string, address: Address): Position {
    let byUser = this.positions.get(roundId);
    if (!byUser) {
      byUser = new Map();
      this.positions.set(roundId, byUser);
    }
    let p = byUser.get(address);
    if (!p) {
      p = { userAddress: address, roundId, tokens: 0, costBasisEth: 0, realizedPnl: 0 };
      byUser.set(address, p);
    }
    return p;
  }

  logAdmin(action: string, detail: string): void {
    this.adminLog.push({ id: this.id(), at: Date.now(), action, detail });
  }

  /**
   * Append a structured Command Center audit entry. This is the record the ops
   * team reads back — actor, module, before and after — so it is kept longer
   * and trimmed less aggressively than the free-text admin log.
   */
  recordAudit(entry: AuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > 5000) this.auditLog.splice(0, this.auditLog.length - 5000);
  }

  // ---- gameplay configuration resolvers ----
  // Everything gameplay-tunable is read through these, never from the compiled
  // constants, so a Command Center edit takes effect on the next round without
  // a deploy. Each falls back to the default when nothing is stored.

  /** Round economics for a risk tier. Returns a copy — callers mutate it. */
  tierConfig(tier: RiskTier): RoundConfig {
    return { ...(this.settings.game.tiers[tier] ?? TIER_CONFIGS[tier]) };
  }

  /** The tunable half of a game mode, merged over its compiled definition. */
  modeDef(mode: GameMode): GameModeDef {
    const base = GAME_MODE_MAP[mode];
    const o = this.settings.game.modes[mode];
    return o ? { ...base, ...o, disabled: o.disabled } : base;
  }

  /** Is this mode launchable right now? */
  modeEnabled(mode: GameMode): boolean {
    return !this.modeDef(mode).disabled;
  }

  /** XP paid for an event. */
  xpFor(kind: XpEventKind): number {
    return this.settings.game.xp[kind] ?? XP_AWARDS[kind];
  }

  /** The bonding target in pETH market cap, at the live ETH price. */
  bondTargetEth(): number {
    return this.settings.game.bondTargetUsd / this.ethUsd;
  }

  /** Quest definitions with the stored target/XP overrides applied, disabled
   *  ones dropped. `period` narrows to dailies (today's rotation) or weeklies. */
  missionDefs(period: "daily" | "weekly", now = Date.now()): MissionDef[] {
    const g = this.settings.game;
    const pool =
      period === "daily" ? activeDailyMissions(now, g.dailyActiveCount) : WEEKLY_MISSIONS;
    const copy = this.copyMap();
    return pool
      .filter((m) => g.missions[m.id]?.enabled !== false)
      .map((m) => ({
        ...resolveMission(m, g),
        // Names and descriptions are editable copy, so the board shows whatever
        // the Command Center says rather than the compiled wording.
        name: copyText(copy, `mission.${m.id}.name`),
        description: copyText(copy, `mission.${m.id}.description`),
      }));
  }

  /** Every quest live right now, dailies first. */
  liveMissions(now = Date.now()): MissionDef[] {
    return [...this.missionDefs("daily", now), ...this.missionDefs("weekly", now)];
  }

  /** Record a Telegram delivery outcome. Bounded so a broken chat id can't
   *  grow the log without limit. */
  logTelegram(entry: Omit<TelegramLogEntry, "id" | "at">): void {
    this.telegramLog.push({ id: this.id(), at: Date.now(), ...entry });
    if (this.telegramLog.length > 1000) this.telegramLog.splice(0, this.telegramLog.length - 1000);
  }

  /** Is an automated Telegram event switched on? */
  telegramEventEnabled(key: string): boolean {
    const tg = this.settings.telegram;
    return tg.enabled && tg.events[key]?.enabled !== false;
  }

  /** Every site string, defaults with the operator's overrides applied. */
  copyMap(): Record<string, string> {
    return resolveCopy(this.settings.copy);
  }

  /** One site string. Used where the server renders player-facing text. */
  text(key: string): string {
    return copyText(this.copyMap(), key);
  }

  /**
   * The display title for a level, honouring the editable copy. Level titles
   * are stamped onto the user record when they level up, so this is where an
   * edit has to be applied — a title already stamped keeps its old wording
   * until the player next levels, which is the honest behaviour: we don't
   * rewrite history on a copy change.
   */
  titleFor(level: number): string {
    const bracket = LEVEL_TITLES.find((t) => level >= t.minLevel);
    return bracket ? copyText(this.copyMap(), `levelTitle.${bracket.minLevel}`) : titleForLevel(level);
  }

  /** Every feature flag resolved against its registry default. */
  flags(): Record<string, boolean> {
    return resolveFlags(this.featureFlags);
  }

  /** Is a single feature switched on right now? */
  flag(key: string): boolean {
    return flagEnabled(this.featureFlags, key);
  }

  /** Record an @-mention ping for a player (newest first, keep the last 50). */
  addPing(target: Address, entry: PingEntry): void {
    const list = this.pings.get(target) ?? [];
    list.unshift(entry);
    if (list.length > 50) list.length = 50;
    this.pings.set(target, list);
  }

  /**
   * Record mission-relevant activity for both the current day and ISO week,
   * then award XP for any missions that just completed.
   */
  trackActivity(address: Address, metric: MissionMetric, amount = 1, now = Date.now()): void {
    const u = this.getOrCreateUser(address);
    const dk = dayKey(now);
    const wk = weekKey(now);
    for (const key of [dk, wk]) {
      const bucket = (u.activity[key] ??= {});
      bucket[metric] = (bucket[metric] ?? 0) + amount;
    }
    // Prune stale periods so the record stays small.
    const keys = Object.keys(u.activity);
    if (keys.length > 20) {
      for (const k of keys.sort().slice(0, keys.length - 12)) delete u.activity[k];
    }

    // Only today's rotating daily set (plus all weeklies) can be completed, and
    // only the quests still switched on, at their configured target and payout.
    const activeDaily = this.missionDefs("daily", now);
    const relevant = [...activeDaily, ...this.missionDefs("weekly", now)];
    for (const m of relevant) {
      if (m.metric !== metric) continue;
      const pk = m.period === "daily" ? dk : wk;
      const doneKey = `${pk}:${m.id}`;
      if (u.missionsDone[doneKey]) continue;
      if ((u.activity[pk]?.[m.metric] ?? 0) >= m.target) {
        u.missionsDone[doneKey] = true;
        // Daily quests are floor (capped); weekly challenges are ceiling.
        this.addXp(
          address,
          m.xp,
          m.period === "daily" ? "floor" : "ceiling",
          m.period === "daily" ? "quests" : "challenges",
        );
        // Burger economy: completing a quest pays Burgers + the first-quest
        // milestone for that cadence.
        if (m.period === "daily") {
          awardBurger(this, address, "daily_quest", { ref: m.id, now });
          awardBurgerOneTime(this, address, "first_daily", now);
        } else {
          awardBurger(this, address, "weekly_quest", { ref: m.id, now });
          awardBurgerOneTime(this, address, "first_weekly", now);
        }
      }
    }

    // Set-completion bonuses: clear every active daily / every weekly.
    const dailyBonusKey = `${dk}:__daily_set__`;
    if (
      !u.missionsDone[dailyBonusKey] &&
      activeDaily.every((m) => u.missionsDone[`${dk}:${m.id}`])
    ) {
      u.missionsDone[dailyBonusKey] = true;
      this.addXp(address, this.settings.game.dailySetBonusXp, "floor", "quests");
    }
    const weeklyBonusKey = `${wk}:__weekly_set__`;
    if (
      !u.missionsDone[weeklyBonusKey] &&
      this.missionDefs("weekly", now).every((m) => u.missionsDone[`${wk}:${m.id}`])
    ) {
      u.missionsDone[weeklyBonusKey] = true;
      this.addXp(address, this.settings.game.weeklySetBonusXp, "ceiling", "challenges");
      this.bumpWeeklyStreak(address, now);
    }
  }

  /** Advance the daily play streak (call once per round played). Handles freeze
   *  tokens (auto-save one missed day) and pays streak-milestone XP. */
  bumpPlayStreak(address: Address, now = Date.now()): void {
    const u = this.getOrCreateUser(address);
    const today = dayKey(now);
    if (u.lastPlayDay === today) return; // already counted today
    const yesterday = dayKey(now - 86_400_000);
    const twoAgo = dayKey(now - 2 * 86_400_000);
    if (u.lastPlayDay === yesterday) {
      u.playStreak = (u.playStreak ?? 0) + 1;
    } else if (u.lastPlayDay === twoAgo && (u.streakFreezes ?? 0) > 0) {
      u.streakFreezes = (u.streakFreezes ?? 0) - 1; // freeze saves the 1-day gap
      u.playStreak = (u.playStreak ?? 0) + 1;
    } else {
      u.playStreak = 1; // fresh start (first play or streak broken)
    }
    u.lastPlayDay = today;
    u.bestPlayStreak = Math.max(u.bestPlayStreak ?? 0, u.playStreak);
    // Earn a freeze every 7 days played, capped.
    if (u.playStreak % 7 === 0 && (u.streakFreezes ?? 0) < STREAK_FREEZE_MAX) {
      u.streakFreezes = (u.streakFreezes ?? 0) + 1;
    }
    const reward = dailyStreakReward(u.playStreak);
    if (reward > 0) this.addXp(address, reward, "ceiling", "streaks"); // retention
  }

  /** Advance the weekly-consistency streak (call when the weekly set is cleared). */
  bumpWeeklyStreak(address: Address, now = Date.now()): void {
    const u = this.getOrCreateUser(address);
    const thisWeek = weekKey(now);
    if (u.lastWeekSetKey === thisWeek) return;
    const lastWeek = weekKey(now - 7 * 86_400_000);
    u.weekStreak = u.lastWeekSetKey === lastWeek ? (u.weekStreak ?? 0) + 1 : 1;
    u.lastWeekSetKey = thisWeek;
    u.bestWeekStreak = Math.max(u.bestWeekStreak ?? 0, u.weekStreak);
    const reward = weeklyStreakReward(u.weekStreak);
    if (reward > 0) this.addXp(address, reward, "ceiling", "streaks");
  }

  /** Award any newly-crossed lifetime milestone tiers. */
  checkMilestones(address: Address): void {
    const u = this.getOrCreateUser(address);
    for (const ladder of MILESTONES) {
      const value = (u.stats as unknown as Record<string, number>)[ladder.stat] ?? 0;
      for (const tier of ladder.tiers) {
        const key = `milestone:${ladder.id}:${tier.at}`;
        if (!u.missionsDone[key] && value >= tier.at) {
          u.missionsDone[key] = true;
          this.addXp(address, tier.xp, "ceiling", "milestones");
        }
      }
    }
  }

  /** Award any newly-crossed monthly season-pass tiers (cascades once). */
  checkSeasonPass(address: Address): void {
    const u = this.getOrCreateUser(address);
    const key = this.seasonKey();
    let awarded = true;
    while (awarded) {
      awarded = false;
      const seasonXp = u.seasons[key]?.xp ?? 0;
      for (const tier of SEASON_PASS_TIERS) {
        const doneKey = `pass:${key}:${tier.at}`;
        if (!u.missionsDone[doneKey] && seasonXp >= tier.at) {
          u.missionsDone[doneKey] = true;
          this.addXp(address, tier.xp, "ceiling", "season");
          awarded = true; // the kicker may cross the next tier
        }
      }
    }
  }

  missionStatus(address: Address, now = Date.now()) {
    const u = this.getOrCreateUser(address);
    const dk = dayKey(now);
    const wk = weekKey(now);
    // Today's rotating daily set + all weekly challenges, at their configured
    // targets and payouts (disabled quests never appear).
    return this.liveMissions(now).map((m) => {
      const pk = m.period === "daily" ? dk : wk;
      return {
        ...m,
        progress: Math.min(m.target, u.activity[pk]?.[m.metric] ?? 0),
        completed: !!u.missionsDone[`${pk}:${m.id}`],
      };
    });
  }

  /** Streaks, lifetime milestone ladders, and monthly season-pass progress. */
  progressStatus(address: Address, now = Date.now()) {
    const u = this.getOrCreateUser(address);
    const seasonXp = u.seasons[this.seasonKey(now)]?.xp ?? 0;
    const stats = u.stats as unknown as Record<string, number>;
    return {
      streak: {
        current: u.playStreak ?? 0,
        best: u.bestPlayStreak ?? 0,
        freezes: u.streakFreezes ?? 0,
        playedToday: u.lastPlayDay === dayKey(now),
      },
      weekStreak: { current: u.weekStreak ?? 0, best: u.bestWeekStreak ?? 0 },
      milestones: MILESTONES.map((l) => {
        const value = stats[l.stat] ?? 0;
        return {
          id: l.id,
          name: l.name,
          unit: l.unit,
          value,
          tiers: l.tiers.map((t) => ({ at: t.at, xp: t.xp, done: value >= t.at })),
        };
      }),
      seasonPass: {
        xp: seasonXp,
        tiers: SEASON_PASS_TIERS.map((t) => ({
          at: t.at,
          xp: t.xp,
          reward: t.reward,
          done: seasonXp >= t.at,
        })),
      },
    };
  }

  /** Serializable snapshot of durable state (live rounds stay ephemeral). */
  /** Resolve a session token, expiring it lazily. */
  sessionAddress(token: string): Address | undefined {
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return s.address;
  }

  snapshot(): Snapshot {
    return {
      version: 1,
      users: [...this.users.values()],
      concepts: [...this.concepts.values()],
      conceptVoters: [...this.conceptVoters.entries()].map(([id, set]) => [id, [...set]]),
      archivedRounds: [...this.rounds.values()].filter((r) => r.state === "results"),
      candles: [...this.candles.entries()].filter(
        ([roundId]) => this.rounds.get(roundId)?.state === "results",
      ),
      auctionResults: [...this.auctionResults.values()],
      summaries: [...this.summaries.values()],
      adminLog: this.adminLog.slice(-1000),
      // Command Center: accounts, the audit trail and flag overrides are
      // durable. Live staff sessions deliberately are not — a restart signs
      // operators out rather than resurrecting tokens from disk.
      staff: [...this.staff.values()],
      auditLog: this.auditLog.slice(-5000),
      featureFlags: { ...this.featureFlags },
      media: [...this.media.values()],
      telegramLog: this.telegramLog.slice(-500),
      betaSignups: [...this.betaSignups.values()],
      // Sessions persist so a deploy/restart never signs the beta out.
      sessions: [...this.sessions.entries()]
        .filter(([, s]) => s.expiresAt > Date.now())
        .slice(-5000),
      feedback: this.feedback.slice(-2000),
      settings: this.settings,
      // Mutes/bans survive restarts; expired ones are pruned on save.
      muted: [...this.muted.entries()].filter(([, until]) => until > Date.now()),
      jackpotPool: this.jackpotPool,
      jackpotWeekKey: this.jackpotWeekKey,
      jackpotHistory: this.jackpotHistory.slice(-52),
      jackpotLifetimeEth: this.jackpotLifetimeEth,
      weeklyVolume: this.weeklyVolume,
      weeklyFees: this.weeklyFees,
      pitCarry: this.pitCarry,
      burgerRevenueLedger: this.burgerRevenueLedger.slice(-5000),
      burgerRevenueBuckets: this.burgerRevenueBuckets,
      burgerRevenueEth: this.burgerRevenueEth,
      burgerBySource: this.burgerBySource,
      burgerDaily: this.burgerDaily,
      goonMemory: this.goonMemory,
    };
  }

  hydrate(snap: Snapshot): void {
    for (const u of snap.users) {
      // Older snapshots may predate newer fields; fill defaults.
      u.activity ??= {};
      u.missionsDone ??= {};
      u.equipped ??= {};
      u.history ??= [];
      u.referralCount ??= 0;
      u.referralEarnings ??= 0;
      u.weeklyXp ??= {};
      u.dailyXp ??= {};
      u.xpBySource ??= {};
      u.arenaBalance ??= 0;
      u.jackpotWinnings ??= 0;
      u.jackpotWins ??= [];
      // Burger economy backfill (snapshots predating $BURG).
      u.burgerBalance ??= 0;
      u.burgerClaims ??= {};
      u.burgerEarned ??= 0;
      u.burgerPurchased ??= 0;
      u.burgerSpent ??= 0;
      this.users.set(u.address, u);
    }
    for (const c of snap.concepts) this.concepts.set(c.id, c);
    for (const [id, voters] of snap.conceptVoters) this.conceptVoters.set(id, new Set(voters));
    for (const r of snap.archivedRounds) this.rounds.set(r.id, r);
    for (const [roundId, candles] of snap.candles ?? []) this.candles.set(roundId, candles);
    for (const a of snap.auctionResults) this.auctionResults.set(a.roundId, a);
    for (const s of snap.summaries) this.summaries.set(s.roundId, s);
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
    for (const [token, s] of snap.sessions ?? []) {
      // Pre-expiry snapshots stored the bare address; grant those the full TTL.
      this.sessions.set(
        token,
        typeof s === "string" ? { address: s, expiresAt: Date.now() + SESSION_TTL_MS } : s,
      );
    }
    this.feedback = snap.feedback ?? [];
    for (const [addr, until] of snap.muted ?? []) {
      if (until > Date.now()) this.muted.set(addr, until);
    }
    if (snap.settings) {
      this.settings = { ...this.settings, ...snap.settings };
      // Merge rather than replace: a snapshot written before a new game mode,
      // quest or achievement shipped has no row for it, and the new content
      // should appear at its default instead of vanishing.
      this.settings.game = mergeGameSettings(snap.settings.game);
      // Presentation settings shipped after some snapshots were written.
      this.settings.branding ??= freshBrandingSettings();
      this.settings.themes ??= freshThemeSettings();
      this.settings.audio ??= freshAudioSettings();
      this.settings.copy ??= {};
      this.settings.telegram = mergeTelegramSettings(
        snap.settings.telegram,
        TELEGRAM_COMMAND_DEFS,
      );
      this.settings.collection = mergeCollectionSettings(snap.settings.collection);
    }
    this.adminLog = snap.adminLog;
    for (const a of snap.staff ?? []) this.staff.set(a.id, a);
    this.auditLog = snap.auditLog ?? [];
    this.featureFlags = snap.featureFlags ?? {};
    for (const m of snap.media ?? []) this.media.set(m.id, m);
    this.telegramLog = snap.telegramLog ?? [];
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
    this.jackpotPool = snap.jackpotPool ?? 0;
    this.jackpotWeekKey = snap.jackpotWeekKey ?? weekKey();
    this.jackpotHistory = snap.jackpotHistory ?? [];
    this.jackpotLifetimeEth = snap.jackpotLifetimeEth ?? 0;
    this.weeklyVolume = snap.weeklyVolume ?? {};
    this.weeklyFees = snap.weeklyFees ?? {};
    // Pit pools no longer carry between matches — any previously-carried money
    // (and any that lands in the field) rolls into the weekly jackpot instead.
    const carried = snap.pitCarry ?? { prediction: 0, trading: 0 };
    this.jackpotPool += (carried.prediction ?? 0) + (carried.trading ?? 0);
    this.pitCarry = { prediction: 0, trading: 0 };
    // Ensure the Pit settings block exists + carries new prediction-market
    // knobs on snapshots that predate them.
    this.settings.pit = { ...freshPitSettings(), ...(this.settings.pit ?? {}) };
    // Bets are now placed in USD ($5 min) rather than a high pETH floor; drop the
    // legacy 0.05 pETH minimum on snapshots that predate the change.
    if (this.settings.pit.minBet >= 0.05) this.settings.pit.minBet = PIT_DEFAULTS.minBet;
    // The queue now runs a 60s arm countdown; raise the legacy 45s on old snapshots.
    if (this.settings.pit.lobbySeconds === 45) this.settings.pit.lobbySeconds = PIT_DEFAULTS.lobbySeconds;
    // Backfill per-tier Flame Trial PnL bars on tiers persisted before they were
    // tier-scoped (match by name, else fall back to the base requirement).
    this.settings.pit.trialTiers = (this.settings.pit.trialTiers ?? []).map((t) => ({
      ...t,
      requiredPnlBps:
        t.requiredPnlBps ??
        PIT_DEFAULTS.trialTiers.find((d) => d.name === t.name)?.requiredPnlBps ??
        this.settings.pit.trialRequiredPnlBps,
    }));
    // Backfill new pitStats fields on existing players.
    for (const u of this.users.values())
      if (u.pitStats) u.pitStats = { ...emptyPitStats(), ...u.pitStats };
    // Burger economy: ensure the settings block exists + carries new knobs on
    // snapshots that predate it, and restore site-wide accounting.
    this.settings.burger = { ...freshBurgerSettings(), ...(this.settings.burger ?? {}) };
    this.burgerRevenueLedger = snap.burgerRevenueLedger ?? [];
    this.burgerRevenueBuckets = { ...this.burgerRevenueBuckets, ...(snap.burgerRevenueBuckets ?? {}) };
    this.burgerRevenueEth = snap.burgerRevenueEth ?? 0;
    this.burgerBySource = snap.burgerBySource ?? {};
    this.burgerDaily = snap.burgerDaily ?? {};
    // Goon Squad: carry new behavior knobs, keep persisted persona edits. New
    // roster members added in code appear; admin-tuned ones are preserved.
    this.settings.goons = { ...freshGoonSettings(), ...(this.settings.goons ?? {}) };
    if (!this.settings.goons.personas?.length) this.settings.goons.personas = freshGoonSettings().personas;
    this.goonMemory = snap.goonMemory ?? { recentWinners: [], streaks: {} };
    this.reindexArena();
    this.reindexTelegram();
  }
}

export interface FeedbackEntry {
  id: string;
  address: Address;
  displayName?: string;
  text: string;
  page?: string;
  at: number;
}

export interface OpsSettings {
  /** Keep the match calendar auto-filling from top-voted submissions. */
  autoSchedule: boolean;
  tier: RiskTier;
  /** Seconds between a slot being scheduled and the lobby opening. */
  leadSeconds: number;
  /** The paper bot swarm — lobby chat, queue pull-ups, live trading. */
  bots: boolean;
  /** Rotating announcements posted into The Grill (global chat). */
  announceTips: string[];
  /** Minutes between announcements; 0 turns them off. */
  announceEveryMin: number;
  /** Pinned announcement shown above The Grill; "" = nothing pinned. */
  pinnedAnnouncement: string;
  /** Rug bans: ON = players clear their own ban from their profile (paper
   *  beta); OFF = bans wait out the rugBanHours schedule (real money). */
  selfServeUnban: boolean;
  /** Wait-out ban lengths in hours by offense count; last entry repeats. */
  rugBanHours: number[];
  /** True once the Telegram Welcome/Links/Founders messages have been pinned. */
  telegramPinsDone?: boolean;
  /** The Pit economy + Swarm AI knobs. */
  pit: PitSettings;
  /** The Burger economy ($BURG) — reward rules, milestones, revenue split. */
  burger: BurgerSettings;
  /** The Flame Goon Squad AI — personalities, dialogue pools, behavior. */
  goons: GoonSettings;
  /** Gameplay configuration: tiers, modes, XP, quests, achievements. Seeded
   *  from the compiled constants and edited from the Command Center. */
  game: GameSettings;
  /** Logos, icons, share images and brand colours. */
  branding: BrandingSettings;
  /** Seasonal themes and their schedule. */
  themes: ThemeSettings;
  /** Sound cue assignments and volumes. */
  audio: AudioSettings;
  /** Site copy overrides, sparse: key → text. Anything absent uses the
   *  shipped default from the copy registry. */
  copy: Record<string, string>;
  /** Telegram operations: connection overrides, automation, schedules,
   *  commands and moderation. Env remains the fallback for the connection. */
  telegram: TelegramSettings;
  /** The Flame Goon Squad Collection: catalogue, sets, drop table and packs. */
  collection: CollectionSettings;
}

/** Deep-copied default Goon Squad settings (roster + behavior). */
export function freshGoonSettings(): GoonSettings {
  return {
    ...GOON_DEFAULTS,
    personas: GOON_ROSTER.map((p) => ({
      ...p,
      rivals: [...p.rivals],
      favoriteTopics: [...p.favoriteTopics],
      pools: Object.fromEntries(
        Object.entries(p.pools).map(([k, v]) => [k, v.map((l) => ({ ...l }))]),
      ),
    })),
  };
}

/** Deep-copied default Burger settings so admin edits never touch the const. */
export function freshBurgerSettings(): BurgerSettings {
  return {
    ...BURGER_DEFAULTS,
    rules: BURGER_DEFAULTS.rules.map((r) => ({ ...r })),
    xpMilestones: BURGER_DEFAULTS.xpMilestones.map((m) => ({ ...m })),
    oneTimeMilestones: BURGER_DEFAULTS.oneTimeMilestones.map((m) => ({ ...m })),
    revenueAllocation: { ...BURGER_DEFAULTS.revenueAllocation },
  };
}

/** Admin-tunable Pit economy and Swarm behavior (see PIT_DEFAULTS). */
export interface PitSettings {
  tradingFee: number;
  pitFeeBps: number;
  feeSplit: PitFeeSplit;
  startingStack: number;
  lobbySeconds: number;
  queueMaxSeconds: number;
  maxConcurrent: number;
  carryover: boolean;
  /** Swarm trade size/cadence, 0..1. */
  aggression: number;
  /** Swarm market difficulty for traders, 0..1. */
  difficulty: number;
  /** Duration presets creators may launch. */
  durations: PitDurationKey[];
  // ---- Prediction market ----
  minBet: number;
  maxBet: number;
  quickChips: number[];
  mainAllocationBps: number;
  houseAllocationBps: number;
  doubleDownBonus: number;
  doubleDownType: PitBonusType;
  houseSpecials: HouseSpecialKind[];
  // Flame Trial
  trialRequiredPnlBps: number;
  trialMinUsd: number;
  trialMaxUsd: number;
  trialTiers: TrialTier[];
  trialLobbySeconds: number;
}

/** Deep-copied default Pit settings so admin edits never touch the shared const. */
export function freshPitSettings(): PitSettings {
  return {
    ...PIT_DEFAULTS,
    feeSplit: { ...PIT_DEFAULTS.feeSplit },
    durations: [...PIT_DEFAULTS.durations],
    quickChips: [...PIT_DEFAULTS.quickChips],
    houseSpecials: [...PIT_DEFAULTS.houseSpecials],
    trialTiers: PIT_DEFAULTS.trialTiers.map((t) => ({ ...t })),
  };
}

/** A fresh lifetime Pit record. */
export function emptyPitStats(): PitStats {
  return {
    matchesPlayed: 0,
    predictionMarketsPlayed: 0,
    predictionsMade: 0,
    predictionsCorrect: 0,
    predictionWins: 0,
    predictionStaked: 0,
    predictionEarnings: 0,
    houseEntered: 0,
    houseWins: 0,
    houseStaked: 0,
    houseEarnings: 0,
    doubleDowns: 0,
    largestDoubleDown: 0,
    tradingEntries: 0,
    tradingWins: 0,
    tradingStaked: 0,
    trialsPlayed: 0,
    trialsWon: 0,
    trialXp: 0,
    highestTrialPnlPct: 0,
    highestTrialTier: "",
    trialWinStreak: 0,
    bestTrialWinStreak: 0,
    doubleWins: 0,
    highestPnl: 0,
    totalPnl: 0,
    longestProfitStreak: 0,
    currentProfitStreak: 0,
    largestWin: 0,
    totalEarnings: 0,
    carryoverWins: 0,
    byDuration: {
      blitz: { played: 0, wins: 0 },
      standard: { played: 0, wins: 0 },
      marathon: { played: 0, wins: 0 },
    },
  };
}

/**
 * The wallet's active rug ban, if any. Timed bans lift themselves lazily the
 * first time anyone looks after expiry — the record stays, marked "timeout".
 */
export function activeRugBan(u: StoredUser, now = Date.now()): RugBan | undefined {
  const last = u.rugBans?.[u.rugBans.length - 1];
  if (!last || last.liftedAt) return undefined;
  if (last.expiresAt && last.expiresAt <= now) {
    last.liftedAt = last.expiresAt;
    last.liftedBy = "timeout";
    return undefined;
  }
  return last;
}

export interface Snapshot {
  version: number;
  users: StoredUser[];
  concepts: TokenConcept[];
  conceptVoters: Array<[string, Address[]]>;
  archivedRounds: Round[];
  candles?: Array<[string, Candle[]]>;
  auctionResults: AuctionResult[];
  summaries: RoundSummary[];
  adminLog: AdminLogEntry[];
  /** Command Center staff accounts (password hashes included — this snapshot
   *  is server-side only and never served to a client). */
  staff?: StoredStaff[];
  auditLog?: AuditEntry[];
  featureFlags?: Record<string, boolean>;
  media?: MediaAsset[];
  telegramLog?: TelegramLogEntry[];
  betaSignups?: BetaSignup[];
  sessions?: Array<[string, Address | SessionRecord]>;
  feedback?: FeedbackEntry[];
  settings?: OpsSettings;
  /** Chat mutes/bans: address → muted-until epoch ms. */
  muted?: Array<[Address, number]>;
  jackpotPool?: number;
  jackpotWeekKey?: string;
  jackpotHistory?: JackpotPayout[];
  jackpotLifetimeEth?: number;
  weeklyVolume?: Record<string, number>;
  weeklyFees?: Record<string, number>;
  /** Unclaimed Pit prize pools carried into the next match. */
  pitCarry?: { prediction: number; trading: number };
  // ---- Burger economy ($BURG) site-wide accounting ----
  burgerRevenueLedger?: BurgerRevenueEntry[];
  burgerRevenueBuckets?: Record<BurgerRevenueDest, number>;
  burgerRevenueEth?: number;
  burgerBySource?: Partial<Record<BurgerSource, number>>;
  burgerDaily?: Record<string, number>;
  goonMemory?: {
    recentWinners: { name: string; at: number }[];
    streaks: Record<string, number>;
    lastUpset?: { name: string; at: number };
  };
}
