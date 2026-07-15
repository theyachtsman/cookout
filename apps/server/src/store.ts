import { randomUUID } from "node:crypto";
import {
  DEFAULT_ETH_USD,
  MISSIONS,
  type Candle,
  STARTING_PAPER_BALANCE,
  XP_AWARDS,
  dayKey,
  levelForXp,
  periodKey,
  titleForLevel,
  weekKey,
  type EquippedCosmetics,
  type MissionMetric,
  type RoundHistoryEntry,
  type Address,
  type AuctionIntent,
  type AuctionResult,
  type ChatMessage,
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
  sessions = new Map<string, Address>(); // token → address
  nonces = new Map<Address, string>();
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

  addXp(address: Address, amount: number): StoredUser {
    const u = this.getOrCreateUser(address);
    u.xp += amount;
    u.level = levelForXp(u.xp);
    u.title = titleForLevel(u.level);
    const season = (u.seasons[this.seasonKey()] ??= { pnl: 0, xp: 0, wins: 0, trades: 0 });
    season.xp += amount;
    return u;
  }

  grantAchievement(address: Address, id: string): boolean {
    const u = this.getOrCreateUser(address);
    if (u.achievements.includes(id)) return false;
    u.achievements.push(id);
    return true;
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
    for (const key of [dayKey(now), weekKey(now)]) {
      const bucket = (u.activity[key] ??= {});
      bucket[metric] = (bucket[metric] ?? 0) + amount;
    }
    // Prune stale periods so the record stays small.
    const keys = Object.keys(u.activity);
    if (keys.length > 20) {
      for (const k of keys.sort().slice(0, keys.length - 12)) delete u.activity[k];
    }
    for (const m of MISSIONS) {
      if (m.metric !== metric) continue;
      const pk = periodKey(m.period, now);
      const doneKey = `${pk}:${m.id}`;
      if (u.missionsDone[doneKey]) continue;
      if ((u.activity[pk]?.[m.metric] ?? 0) >= m.target) {
        u.missionsDone[doneKey] = true;
        this.addXp(address, m.xp);
      }
    }
  }

  missionStatus(address: Address, now = Date.now()) {
    const u = this.getOrCreateUser(address);
    return MISSIONS.map((m) => {
      const pk = periodKey(m.period, now);
      return {
        ...m,
        progress: Math.min(m.target, u.activity[pk]?.[m.metric] ?? 0),
        completed: !!u.missionsDone[`${pk}:${m.id}`],
      };
    });
  }

  /** Serializable snapshot of durable state (live rounds stay ephemeral). */
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
      sessions: [...this.sessions.entries()].slice(-5000),
      feedback: this.feedback.slice(-2000),
      settings: this.settings,
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
      this.users.set(u.address, u);
    }
    for (const c of snap.concepts) this.concepts.set(c.id, c);
    for (const [id, voters] of snap.conceptVoters) this.conceptVoters.set(id, new Set(voters));
    for (const r of snap.archivedRounds) this.rounds.set(r.id, r);
    for (const [roundId, candles] of snap.candles ?? []) this.candles.set(roundId, candles);
    for (const a of snap.auctionResults) this.auctionResults.set(a.roundId, a);
    for (const s of snap.summaries) this.summaries.set(s.roundId, s);
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
    for (const [token, address] of snap.sessions ?? []) this.sessions.set(token, address);
    this.feedback = snap.feedback ?? [];
    if (snap.settings) this.settings = { ...this.settings, ...snap.settings };
    this.adminLog = snap.adminLog;
    for (const b of snap.betaSignups ?? []) this.betaSignups.set(b.address, b);
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
  sessions?: Array<[string, Address]>;
  feedback?: FeedbackEntry[];
  settings?: OpsSettings;
}
