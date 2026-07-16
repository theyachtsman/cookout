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
  | "correct_predictions"
  | "profitable_rounds"
  | "auctions_entered"
  | "podium_finishes"
  | "dip_buys"
  | "peak_sells"
  | "diamond_holds"
  | "rug_survivals"
  | "first_buys"
  | "graduations_held";

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  period: "daily" | "weekly";
  metric: MissionMetric;
  target: number;
  xp: number;
}

/** Bonus XP for clearing every active daily / the full weekly set. */
export const DAILY_SET_BONUS_XP = 50;
export const WEEKLY_SET_BONUS_XP = 400;
/** How many of the daily pool are active (shown + countable) each day. */
export const DAILY_ACTIVE_COUNT = 4;

export const MISSIONS: MissionDef[] = [
  // ---- Daily pool (a rotating DAILY_ACTIVE_COUNT are live each day) ----
  { id: "d_play_2", name: "Pull Up Twice", description: "Play 2 rounds today", period: "daily", metric: "rounds_played", target: 2, xp: 30 },
  { id: "d_play_4", name: "Regular Customer", description: "Play 4 rounds today", period: "daily", metric: "rounds_played", target: 4, xp: 45 },
  { id: "d_trade_10", name: "Order Flow", description: "Make 10 trades today", period: "daily", metric: "trades", target: 10, xp: 25 },
  { id: "d_win_1", name: "Book a Win", description: "Finish a round in profit today", period: "daily", metric: "profitable_rounds", target: 1, xp: 40 },
  { id: "d_win_2", name: "Double Up", description: "Finish 2 rounds in profit today", period: "daily", metric: "profitable_rounds", target: 2, xp: 60 },
  { id: "d_predict_1", name: "Call It", description: "Make a Moon-or-Rug prediction today", period: "daily", metric: "predictions", target: 1, xp: 15 },
  { id: "d_predict_correct_1", name: "Read the Room", description: "Land a correct prediction today", period: "daily", metric: "correct_predictions", target: 1, xp: 30 },
  { id: "d_auction_1", name: "Fair and Square", description: "Enter a batch auction today", period: "daily", metric: "auctions_entered", target: 1, xp: 20 },
  { id: "d_auction_2", name: "Front of the Line", description: "Enter 2 batch auctions today", period: "daily", metric: "auctions_entered", target: 2, xp: 35 },
  { id: "d_dip_1", name: "Catch the Dip", description: "Buy near a round's bottom today", period: "daily", metric: "dip_buys", target: 1, xp: 35 },
  { id: "d_peak_1", name: "Perfect Exit", description: "Sell near a round's peak today", period: "daily", metric: "peak_sells", target: 1, xp: 35 },
  { id: "d_diamond_1", name: "Diamond Day", description: "Hold a round to the end today", period: "daily", metric: "diamond_holds", target: 1, xp: 30 },
  { id: "d_podium_1", name: "On the Box", description: "Finish top 3 by PnL in a round today", period: "daily", metric: "podium_finishes", target: 1, xp: 40 },
  { id: "d_first_1", name: "First Blood", description: "Be a round's first buyer today", period: "daily", metric: "first_buys", target: 1, xp: 25 },
  { id: "d_rugsurv_1", name: "Survivor", description: "Exit ahead of a rug today", period: "daily", metric: "rug_survivals", target: 1, xp: 40 },
  { id: "d_grad_1", name: "Moon Rider", description: "Hold a round through graduation today", period: "daily", metric: "graduations_held", target: 1, xp: 35 },
  // ---- Weekly challenges (all live all week; clearing the set pays a bonus) ----
  { id: "w_play_20", name: "Regular", description: "Play 20 rounds this week", period: "weekly", metric: "rounds_played", target: 20, xp: 200 },
  { id: "w_win_10", name: "Consistent", description: "Finish 10 rounds in profit this week", period: "weekly", metric: "profitable_rounds", target: 10, xp: 250 },
  { id: "w_trade_50", name: "Volume Dealer", description: "Make 50 trades this week", period: "weekly", metric: "trades", target: 50, xp: 120 },
  { id: "w_podium_3", name: "On the Box", description: "Reach a round podium 3 times this week", period: "weekly", metric: "podium_finishes", target: 3, xp: 250 },
  { id: "w_predict_correct_8", name: "Forecaster", description: "Land 8 correct predictions this week", period: "weekly", metric: "correct_predictions", target: 8, xp: 120 },
  { id: "w_grad_5", name: "Alumni Club", description: "Hold 5 rounds through graduation this week", period: "weekly", metric: "graduations_held", target: 5, xp: 180 },
];

/** FNV-1a hash → deterministic per-day mission rotation. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Low-friction quests any newcomer can clear by just playing — the rotation
 *  always seeds one so a first round never leaves the board empty. */
const STARTER_DAILY_IDS = new Set(["d_play_2", "d_trade_10", "d_auction_1", "d_predict_1"]);

/** The daily missions live for the given day — a stable, date-seeded subset of
 *  the pool so the board rotates without ever depending on a player, but always
 *  including at least one starter quest. */
export function activeDailyMissions(now = Date.now()): MissionDef[] {
  const day = dayKey(now);
  const dailies = MISSIONS.filter((m) => m.period === "daily");
  const rank = (m: MissionDef) => hashStr(day + ":" + m.id);
  const byRank = (a: MissionDef, b: MissionDef) => rank(a) - rank(b);
  const starter = dailies.filter((m) => STARTER_DAILY_IDS.has(m.id)).sort(byRank)[0];
  const rest = dailies
    .filter((m) => m.id !== starter?.id)
    .sort(byRank)
    .slice(0, DAILY_ACTIVE_COUNT - (starter ? 1 : 0));
  return (starter ? [starter, ...rest] : rest).sort(byRank);
}

export const WEEKLY_MISSIONS = MISSIONS.filter((m) => m.period === "weekly");

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

/** Epoch ms of Monday 00:00:00 UTC for the ISO week containing `now`. */
export function weekStart(now = Date.now()): number {
  const d = new Date(now);
  const dayNum = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayNum);
}

/** Epoch ms of the next Monday 00:00:00 UTC — when the weekly jackpot pays out. */
export function nextWeekStart(now = Date.now()): number {
  return weekStart(now) + 7 * 86_400_000;
}
