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
  weekKey,
  type EquippedCosmetics,
  type MissionMetric,
  type RoundHistoryEntry,
  type ActivityEvent,
  type ActivityKind,
  type Address,
  type GameMode,
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
  type PitDurationKey,
  type PitFeeSplit,
  PIT_DEFAULTS,
} from "@cookout/shared";

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
    pit: {
      ...PIT_DEFAULTS,
      feeSplit: { ...PIT_DEFAULTS.feeSplit },
      durations: [...PIT_DEFAULTS.durations],
    },
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
        title: titleForLevel(1),
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
    u.title = titleForLevel(u.level);
    if (u.level > beforeLevel)
      this.pushActivity(u.address, "level_up", `reached Level ${u.level} · ${u.title}`);
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
    const u = this.getOrCreateUser(address);
    if (u.achievements.includes(id)) return false;
    u.achievements.push(id);
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (def) this.pushActivity(u.address, "achievement", `unlocked ${def.name} (${def.rarity})`);
    // One-time XP by rarity — turns the badge wall into a progression track.
    const xp = achievementXp(id);
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
    const give = Math.min(amount, Math.max(0, TRADE_XP.dailyCap - (u.tradeXpToday ?? 0)));
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

    // Only today's rotating daily set (plus all weeklies) can be completed.
    const activeDaily = activeDailyMissions(now);
    const relevant = [...activeDaily, ...WEEKLY_MISSIONS];
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
      }
    }

    // Set-completion bonuses: clear every active daily / every weekly.
    const dailyBonusKey = `${dk}:__daily_set__`;
    if (
      !u.missionsDone[dailyBonusKey] &&
      activeDaily.every((m) => u.missionsDone[`${dk}:${m.id}`])
    ) {
      u.missionsDone[dailyBonusKey] = true;
      this.addXp(address, DAILY_SET_BONUS_XP, "floor", "quests");
    }
    const weeklyBonusKey = `${wk}:__weekly_set__`;
    if (
      !u.missionsDone[weeklyBonusKey] &&
      WEEKLY_MISSIONS.every((m) => u.missionsDone[`${wk}:${m.id}`])
    ) {
      u.missionsDone[weeklyBonusKey] = true;
      this.addXp(address, WEEKLY_SET_BONUS_XP, "ceiling", "challenges");
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
    // Today's rotating daily set + all weekly challenges.
    return [...activeDailyMissions(now), ...WEEKLY_MISSIONS].map((m) => {
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
    if (snap.settings) this.settings = { ...this.settings, ...snap.settings };
    this.adminLog = snap.adminLog;
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
    this.jackpotPool = snap.jackpotPool ?? 0;
    this.jackpotWeekKey = snap.jackpotWeekKey ?? weekKey();
    this.jackpotHistory = snap.jackpotHistory ?? [];
    this.jackpotLifetimeEth = snap.jackpotLifetimeEth ?? 0;
    this.weeklyVolume = snap.weeklyVolume ?? {};
    this.weeklyFees = snap.weeklyFees ?? {};
    this.pitCarry = snap.pitCarry ?? { prediction: 0, trading: 0 };
    // Ensure the Pit settings block exists on snapshots that predate The Pit.
    this.settings.pit ??= {
      ...PIT_DEFAULTS,
      feeSplit: { ...PIT_DEFAULTS.feeSplit },
      durations: [...PIT_DEFAULTS.durations],
    };
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
}

/** Admin-tunable Pit economy and Swarm behavior (see PIT_DEFAULTS). */
export interface PitSettings {
  predictionFee: number;
  tradingFee: number;
  pitFeeBps: number;
  feeSplit: PitFeeSplit;
  startingStack: number;
  lobbySeconds: number;
  maxConcurrent: number;
  carryover: boolean;
  /** Swarm trade size/cadence, 0..1. */
  aggression: number;
  /** Swarm market difficulty for traders, 0..1. */
  difficulty: number;
  /** Duration presets creators may launch. */
  durations: PitDurationKey[];
}

/** A fresh lifetime Pit record. */
export function emptyPitStats(): PitStats {
  return {
    matchesPlayed: 0,
    predictionsMade: 0,
    predictionsCorrect: 0,
    predictionWins: 0,
    tradingEntries: 0,
    tradingWins: 0,
    doubleWins: 0,
    highestPnl: 0,
    totalPnl: 0,
    longestProfitStreak: 0,
    currentProfitStreak: 0,
    largestWin: 0,
    totalEarnings: 0,
    predictionStaked: 0,
    tradingStaked: 0,
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
}
