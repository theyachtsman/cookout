import { randomUUID } from "node:crypto";
import {
  STARTING_PAPER_BALANCE,
  levelForXp,
  titleForLevel,
  type Address,
  type AuctionIntent,
  type AuctionResult,
  type ChatMessage,
  type KillFeedEvent,
  type Position,
  type Prediction,
  type Round,
  type RoundSummary,
  type TokenConcept,
  type Trade,
  type UserProfile,
} from "@cookout/shared";

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
  positions = new Map<string, Map<Address, Position>>(); // roundId → address → position
  chat = new Map<string, ChatMessage[]>();
  killfeed = new Map<string, KillFeedEvent[]>();
  predictions = new Map<string, Map<Address, Prediction>>();
  summaries = new Map<string, RoundSummary>();
  adminLog: AdminLogEntry[] = [];
  /** Platform fee revenue collected per round (paper ETH). */
  feesByRound = new Map<string, number>();

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
}
