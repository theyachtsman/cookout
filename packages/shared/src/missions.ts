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
  | "graduations_held"
  // The Pit (PvE vs Swarm AI)
  | "pit_played"
  | "pit_predictions_correct"
  | "pit_trading_wins"
  | "pit_double_wins"
  // Flame Trial (solo PvE)
  | "trial_played"
  | "trial_won"
  | "trial_target_hit"
  // Endurance (the no-timer launchpad track)
  | "endurance_played"
  | "endurance_profit"
  | "endurance_long_holds"
  | "endurance_bonds";

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
  // ---- The Pit dailies (PvE vs Swarm AI) ----
  { id: "d_pit_play_1", name: "Enter The Pit", description: "Play a Pit match today", period: "daily", metric: "pit_played", target: 1, xp: 25 },
  { id: "d_pit_predict_1", name: "Read the Swarm", description: "Land a correct Pit prediction today", period: "daily", metric: "pit_predictions_correct", target: 1, xp: 35 },
  { id: "d_pit_trade_1", name: "Beat the Swarm", description: "Qualify in a Pit trading pool today", period: "daily", metric: "pit_trading_wins", target: 1, xp: 40 },
  // ---- Flame Trial dailies (solo PvE) ----
  { id: "d_trial_play_1", name: "Into the Fire", description: "Play a Flame Trial today", period: "daily", metric: "trial_played", target: 1, xp: 30 },
  { id: "d_trial_win_1", name: "Flame Survivor", description: "Win a Flame Trial today", period: "daily", metric: "trial_won", target: 1, xp: 45 },
  // ---- Endurance dailies (no-timer launchpad) ----
  { id: "d_end_play_1", name: "Slow Cook", description: "Play an Endurance launch today", period: "daily", metric: "endurance_played", target: 1, xp: 30 },
  { id: "d_end_profit_1", name: "Patience Pays", description: "Finish an Endurance launch in profit today", period: "daily", metric: "endurance_profit", target: 1, xp: 45 },
  { id: "d_end_hold_1", name: "Sit On It", description: "Hold an Endurance position for an hour today", period: "daily", metric: "endurance_long_holds", target: 1, xp: 40 },
  // ---- Weekly challenges (all live all week; clearing the set pays a bonus) ----
  { id: "w_play_20", name: "Regular", description: "Play 20 rounds this week", period: "weekly", metric: "rounds_played", target: 20, xp: 200 },
  { id: "w_win_10", name: "Consistent", description: "Finish 10 rounds in profit this week", period: "weekly", metric: "profitable_rounds", target: 10, xp: 250 },
  { id: "w_trade_50", name: "Volume Dealer", description: "Make 50 trades this week", period: "weekly", metric: "trades", target: 50, xp: 120 },
  { id: "w_podium_3", name: "On the Box", description: "Reach a round podium 3 times this week", period: "weekly", metric: "podium_finishes", target: 3, xp: 250 },
  { id: "w_predict_correct_8", name: "Forecaster", description: "Land 8 correct predictions this week", period: "weekly", metric: "correct_predictions", target: 8, xp: 120 },
  { id: "w_grad_5", name: "Alumni Club", description: "Hold 5 rounds through graduation this week", period: "weekly", metric: "graduations_held", target: 5, xp: 180 },
  // ---- The Pit weeklies ----
  { id: "w_pit_play_10", name: "Pit Regular", description: "Play 10 Pit matches this week", period: "weekly", metric: "pit_played", target: 10, xp: 200 },
  { id: "w_pit_trade_5", name: "Swarm Slayer", description: "Qualify in 5 Pit trading pools this week", period: "weekly", metric: "pit_trading_wins", target: 5, xp: 220 },
  { id: "w_pit_double_1", name: "Double Trouble", description: "Land a Pit Double Winner this week", period: "weekly", metric: "pit_double_wins", target: 1, xp: 180 },
  // ---- Flame Trial weeklies ----
  { id: "w_trial_play_5", name: "Trial Regular", description: "Play 5 Flame Trials this week", period: "weekly", metric: "trial_played", target: 5, xp: 180 },
  { id: "w_trial_win_3", name: "Fire Walker", description: "Win 3 Flame Trials this week", period: "weekly", metric: "trial_won", target: 3, xp: 240 },
  // ---- Endurance weeklies ----
  { id: "w_end_play_5", name: "The Long Game", description: "Play 5 Endurance launches this week", period: "weekly", metric: "endurance_played", target: 5, xp: 200 },
  { id: "w_end_profit_3", name: "Patience Pays", description: "Finish 3 Endurance launches in profit this week", period: "weekly", metric: "endurance_profit", target: 3, xp: 240 },
  { id: "w_end_bond_1", name: "Went the Distance", description: "Hold an Endurance coin through its bond this week", period: "weekly", metric: "endurance_bonds", target: 1, xp: 220 },
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
export function activeDailyMissions(now = Date.now(), activeCount = DAILY_ACTIVE_COUNT): MissionDef[] {
  const day = dayKey(now);
  const dailies = MISSIONS.filter((m) => m.period === "daily");
  const rank = (m: MissionDef) => hashStr(day + ":" + m.id);
  const byRank = (a: MissionDef, b: MissionDef) => rank(a) - rank(b);
  const starter = dailies.filter((m) => STARTER_DAILY_IDS.has(m.id)).sort(byRank)[0];
  const rest = dailies
    .filter((m) => m.id !== starter?.id)
    .sort(byRank)
    .slice(0, Math.max(0, activeCount - (starter ? 1 : 0)));
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

/** Epoch ms of the next UTC midnight — when the daily quests reset. */
export function nextDayStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
