import type { RiskTier } from "./types.js";

/** XP awarded per event. XP is engagement-based, never purchasable. */
export const XP_AWARDS = {
  participation: 15,
  first_buy: 10,
  win_trade: 25,
  big_winner: 75, // >100% round PnL
  perfect_exit: 60, // sold within 5% of round peak
  diamond_hands: 40, // held ≥75% of round duration
  longest_hold: 30,
  whale_hunter: 50, // profited selling into a whale entry
  rug_survivor: 80, // exited ≥50% before a rug
  prediction_correct: 20,
  launched_graduate: 200, // creator whose round graduated
  community_pick: 100, // creator whose submission won the vote
  degen_survivor: 80, // positive PnL in a degen round
} as const;

export type XpEventKind = keyof typeof XP_AWARDS;

/** Round-podium XP by finishing rank (1st, 2nd, 3rd by round PnL). Zero-sum —
 *  only three per round — so it can't be farmed by splitting into wallets. */
export const PODIUM_XP = [60, 35, 20] as const;

/** One-time XP for unlocking an achievement, by rarity. */
export const ACHIEVEMENT_XP: Record<AchievementDef["rarity"], number> = {
  common: 25,
  rare: 60,
  epic: 120,
  legendary: 300,
};

/**
 * Per-trade XP with geometric decay and a per-round cap, so buys and sells feel
 * rewarding without letting volume be farmed for XP: trade n pays
 * `round(5 · 0.6^(n-1))` — 5, 3, 2, 1, 1, 0… — capped at 12 XP/round and (via
 * the store) 60 XP/day. A thousand wash trades earn what six real ones do.
 */
export const TRADE_XP = { base: 5, decay: 0.6, roundCap: 12, dailyCap: 60 } as const;
export function tradeXpForIndex(n: number): number {
  return Math.round(TRADE_XP.base * Math.pow(TRADE_XP.decay, n - 1));
}

/** Cumulative XP required to reach each level (1-indexed; level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(80 * Math.pow(level - 1, 1.6));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 100 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Player titles by level bracket. Levels never reset. */
export const LEVEL_TITLES: Array<{ minLevel: number; title: string }> = [
  { minLevel: 95, title: "Robinhood King" },
  { minLevel: 80, title: "Legend" },
  { minLevel: 65, title: "Market Maker" },
  { minLevel: 50, title: "Whale" },
  { minLevel: 35, title: "Degen" },
  { minLevel: 20, title: "Sniper" },
  { minLevel: 10, title: "Ape" },
  { minLevel: 1, title: "Rookie" },
];

export function titleForLevel(level: number): string {
  return LEVEL_TITLES.find((t) => level >= t.minLevel)!.title;
}

/** Risk-tier access is gated by level only — never by payment. */
export const TIER_UNLOCK_LEVEL: Record<RiskTier, number> = {
  rookie: 1,
  standard: 10,
  degen: 35,
};

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Cosmetic rarity tier — affects badge styling only. */
  rarity: "common" | "rare" | "epic" | "legendary";
}

/**
 * Achievement metadata. Evaluation logic lives server-side
 * (apps/server/src/gamification.ts); this registry is what clients render.
 * Designed to grow — add entries freely, ids are permanent.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_blood", name: "First Blood", description: "First buy of a round", rarity: "common" },
  { id: "diamond_hands", name: "Diamond Hands", description: "Held through ≥75% of a round", rarity: "rare" },
  { id: "paper_hands", name: "Paper Hands", description: "Sold within 10 seconds of buying", rarity: "common" },
  { id: "hundred_x", name: "100X Club", description: "Closed a round at 100x entry", rarity: "legendary" },
  { id: "moon_rider", name: "Moon Rider", description: "Held to a graduation", rarity: "epic" },
  { id: "rug_survivor", name: "Rug Survivor", description: "Exited ≥50% before a rug", rarity: "rare" },
  { id: "whale_hunter", name: "Whale Hunter", description: "Sold profitably into a whale entry", rarity: "rare" },
  { id: "perfect_exit", name: "Perfect Exit", description: "Sold within 5% of the round peak", rarity: "epic" },
  { id: "comeback_kid", name: "Comeback Kid", description: "Recovered from -50% to profit in one round", rarity: "epic" },
  { id: "lucky_bastard", name: "Lucky Bastard", description: "Bought within 5 seconds of the round bottom", rarity: "rare" },
  { id: "graduate_launcher", name: "Launched a Graduate", description: "Created a round that graduated", rarity: "epic" },
  { id: "community_pick", name: "Community Pick", description: "Won a community vote as creator", rarity: "rare" },
  { id: "degen_survivor", name: "Degen Arena Survivor", description: "Profitable round in the Degen Arena", rarity: "epic" },
  { id: "streak_5", name: "Heater", description: "5 winning rounds in a row", rarity: "rare" },
  { id: "oracle", name: "Oracle", description: "10 correct Moon-or-Rug predictions", rarity: "rare" },
];

/** One-time XP an achievement grants on first unlock (0 if unknown id). */
export function achievementXp(id: string): number {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return a ? ACHIEVEMENT_XP[a.rarity] : 0;
}
