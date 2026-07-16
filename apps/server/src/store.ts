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
  achievementXp,
  activeDailyMissions,
  dailyStreakReward,
  weeklyStreakReward,
  type Candle,
  STARTING_PAPER_BALANCE,
  TRADE_XP,
  dayKey,
  levelForXp,
  titleForLevel,
  weekKey,
  type EquippedCosmetics,
  type MissionMetric,
  type RoundHistoryEntry,
  type Address,
  type AuctionIntent,
  type AuctionResult,
  type ChatMessage,
  type JackpotPayout,
  type KillFeedEvent,
  type Position,
  type Prediction,
  type RiskTier,
  type Round,
  type RoundSummary,
  type TokenConcept,
  type Trade,
  type UserProfile,
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

export interface StoredUser extends UserProfile {
  /** Per-season (YYYY-MM) aggregates for seasonal leaderboards. */
  seasons: Record<string, SeasonStats>;
  /** XP earned per ISO week (key "2026-W29") — drives the weekly jackpot. */
  weeklyXp: Record<string, number>;
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
  adminLog: AdminLogEntry[] = [];
  /** Platform fee revenue collected per round (paper ETH). */
  feesByRound = new Map<string, number>();
  /** Chat mutes: address → muted-until epoch ms (ephemeral moderation state). */
  muted = new Map<Address, number>();
  /** Pre-launch beta signups: wallet → signup record (whitelist source). */
  betaSignups = new Map<Address, BetaSignup>();
  /** Tester feedback, wallet-attached (beta instrumentation). */
  feedback: FeedbackEntry[] = [];
  /** Live-ops settings, adjustable from the admin dashboard. */
  settings: OpsSettings = { autoSchedule: true, tier: "rookie", leadSeconds: 15 };
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

  id(): string {
    return randomUUID();
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
        achievements: [],
        referralCode: key.slice(2, 8),
        referredBy,
        createdAt: Date.now(),
        creatorReputation: 0,
        seasons: {},
        weeklyXp: {},
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
  addXp(address: Address, amount: number, source: "floor" | "ceiling" = "ceiling"): StoredUser {
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
    u.xp += give;
    u.level = levelForXp(u.xp);
    u.title = titleForLevel(u.level);
    const season = (u.seasons[this.seasonKey()] ??= { pnl: 0, xp: 0, wins: 0, trades: 0 });
    season.xp += give;
    const wk = weekKey();
    u.weeklyXp[wk] = (u.weeklyXp[wk] ?? 0) + give;
    return u;
  }

  grantAchievement(address: Address, id: string): boolean {
    const u = this.getOrCreateUser(address);
    if (u.achievements.includes(id)) return false;
    u.achievements.push(id);
    // One-time XP by rarity — turns the badge wall into a progression track.
    const xp = achievementXp(id);
    if (xp > 0) this.addXp(address, xp);
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
      this.addXp(address, give, "floor");
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
        this.addXp(address, m.xp, m.period === "daily" ? "floor" : "ceiling");
      }
    }

    // Set-completion bonuses: clear every active daily / every weekly.
    const dailyBonusKey = `${dk}:__daily_set__`;
    if (
      !u.missionsDone[dailyBonusKey] &&
      activeDaily.every((m) => u.missionsDone[`${dk}:${m.id}`])
    ) {
      u.missionsDone[dailyBonusKey] = true;
      this.addXp(address, DAILY_SET_BONUS_XP, "floor");
    }
    const weeklyBonusKey = `${wk}:__weekly_set__`;
    if (
      !u.missionsDone[weeklyBonusKey] &&
      WEEKLY_MISSIONS.every((m) => u.missionsDone[`${wk}:${m.id}`])
    ) {
      u.missionsDone[weeklyBonusKey] = true;
      this.addXp(address, WEEKLY_SET_BONUS_XP);
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
    if (reward > 0) this.addXp(address, reward); // ceiling (retention)
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
    if (reward > 0) this.addXp(address, reward);
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
          this.addXp(address, tier.xp);
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
          this.addXp(address, tier.xp);
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
      jackpotPool: this.jackpotPool,
      jackpotWeekKey: this.jackpotWeekKey,
      jackpotHistory: this.jackpotHistory.slice(-52),
      jackpotLifetimeEth: this.jackpotLifetimeEth,
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
    if (snap.settings) this.settings = { ...this.settings, ...snap.settings };
    this.adminLog = snap.adminLog;
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
    this.jackpotPool = snap.jackpotPool ?? 0;
    this.jackpotWeekKey = snap.jackpotWeekKey ?? weekKey();
    this.jackpotHistory = snap.jackpotHistory ?? [];
    this.jackpotLifetimeEth = snap.jackpotLifetimeEth ?? 0;
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
  jackpotPool?: number;
  jackpotWeekKey?: string;
  jackpotHistory?: JackpotPayout[];
  jackpotLifetimeEth?: number;
}
