/**
 * Daily missions and weekly challenges (spec §10). Progress is measured
 * against per-period activity counters; rewards are XP only — no paid
 * boosts, no purchasable completion, ever.
 */

export type MissionMetric =
  | "rounds_played"
  | "wins"
  | "trades"
  | "predictions"
  | "profitable_rounds"
  | "auctions_entered";

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  period: "daily" | "weekly";
  metric: MissionMetric;
  target: number;
  xp: number;
}

export const MISSIONS: MissionDef[] = [
  // Daily
  { id: "d_play_2", name: "Pull Up Twice", description: "Play 2 rounds today", period: "daily", metric: "rounds_played", target: 2, xp: 30 },
  { id: "d_trade_10", name: "Order Flow", description: "Make 10 trades today", period: "daily", metric: "trades", target: 10, xp: 25 },
  { id: "d_win_1", name: "Book a Win", description: "Finish a round in profit today", period: "daily", metric: "profitable_rounds", target: 1, xp: 40 },
  { id: "d_predict_1", name: "Call It", description: "Make a Moon-or-Rug prediction today", period: "daily", metric: "predictions", target: 1, xp: 15 },
  { id: "d_auction_1", name: "Fair and Square", description: "Enter a batch auction today", period: "daily", metric: "auctions_entered", target: 1, xp: 20 },
  // Weekly
  { id: "w_play_10", name: "Regular", description: "Play 10 rounds this week", period: "weekly", metric: "rounds_played", target: 10, xp: 150 },
  { id: "w_win_5", name: "Consistent", description: "Finish 5 rounds in profit this week", period: "weekly", metric: "profitable_rounds", target: 5, xp: 200 },
  { id: "w_trade_50", name: "Volume Dealer", description: "Make 50 trades this week", period: "weekly", metric: "trades", target: 50, xp: 120 },
  { id: "w_predict_5", name: "Forecaster", description: "Make 5 predictions this week", period: "weekly", metric: "predictions", target: 5, xp: 80 },
];

/** UTC day key, e.g. "2026-07-14". */
export function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** ISO-week key, e.g. "2026-W29". */
export function weekKey(now = Date.now()): string {
  const d = new Date(now);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function periodKey(period: "daily" | "weekly", now = Date.now()): string {
  return period === "daily" ? dayKey(now) : weekKey(now);
}
