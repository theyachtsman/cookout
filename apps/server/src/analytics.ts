/**
 * Analytics for the Command Center.
 *
 * Everything here is computed on demand from the live store — there is no
 * separate events pipeline, and deliberately so: the data set is small enough
 * to scan, and a derived table would be one more thing to keep correct. If the
 * player base outgrows that, this is the seam to put a rollup behind.
 *
 * Two honesty rules run through it:
 *  - bots and Goon Squad accounts are excluded from every player figure, so a
 *    populated demo lobby never flatters the numbers;
 *  - a day with no data reports zero rather than being omitted, so a sparkline
 *    shows a gap as a gap instead of closing it up.
 */
import { dayKey, type Address } from "@cookout/shared";
import type { Store, StoredUser } from "./store.js";

export interface Point {
  day: string;
  value: number;
}

export interface AnalyticsRange {
  /** Days back from today, inclusive. */
  days: number;
}

const DAY = 86_400_000;

/** A real player: not a paper bot, not a Goon Squad system account. */
export function isRealPlayer(u: StoredUser): boolean {
  return !u.isAI && !u.address.startsWith("0xb07") && !u.address.startsWith("0x900d");
}

/** The last `days` day-keys, oldest first, including today. */
function dayKeys(days: number, now: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * DAY));
  return out;
}

/** Bucket timestamps into a zero-filled daily series. */
function series(days: string[], stamps: number[]): Point[] {
  const counts = new Map<string, number>(days.map((d) => [d, 0]));
  for (const at of stamps) {
    const k = dayKey(at);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return days.map((day) => ({ day, value: counts.get(day)! }));
}

/** Same, but summing an amount per timestamp rather than counting. */
function amountSeries(days: string[], rows: { at: number; amount: number }[]): Point[] {
  const sums = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of rows) {
    const k = dayKey(r.at);
    if (sums.has(k)) sums.set(k, sums.get(k)! + r.amount);
  }
  return days.map((day) => ({ day, value: sums.get(day)! }));
}

export function buildAnalytics(store: Store, range: AnalyticsRange, now = Date.now()) {
  const days = dayKeys(range.days, now);
  const since = now - range.days * DAY;
  const players = [...store.users.values()].filter(isRealPlayer);
  const rounds = [...store.rounds.values()];
  const finished = rounds.filter((r) => r.state === "results" && r.endedAt);

  // ---- players -------------------------------------------------------------
  const signups = series(days, players.map((u) => u.createdAt).filter((t) => t >= since));

  // Activity comes from the per-day XP ledger, which every action writes to —
  // a cheap, already-maintained proxy for "played that day".
  const activeByDay = new Map<string, Set<Address>>(days.map((d) => [d, new Set<Address>()]));
  for (const u of players)
    for (const day of Object.keys(u.dailyXp ?? {}))
      activeByDay.get(day)?.add(u.address);
  const dau = days.map((day) => ({ day, value: activeByDay.get(day)!.size }));

  const todayKey = dayKey(now);
  const weekAgo = new Set<string>(dayKeys(7, now));
  const wau = new Set<Address>();
  for (const [day, set] of activeByDay) if (weekAgo.has(day)) for (const a of set) wau.add(a);

  /**
   * Retention: of the players who signed up on a given day, how many were
   * active N days later. Only cohorts old enough to have had the chance are
   * counted — otherwise a cohort from yesterday would drag D7 to zero.
   */
  const retention = (n: number): { cohort: number; retained: number; pct: number } => {
    let cohort = 0;
    let retained = 0;
    for (const u of players) {
      const joined = u.createdAt;
      if (!joined || joined < since) continue;
      if (now - joined < n * DAY) continue; // not old enough to judge
      cohort++;
      const target = dayKey(joined + n * DAY);
      if ((u.dailyXp ?? {})[target]) retained++;
    }
    return { cohort, retained, pct: cohort ? Math.round((retained / cohort) * 100) : 0 };
  };

  const levels = new Map<number, number>();
  for (const u of players) {
    const bucket = Math.floor(u.level / 10) * 10;
    levels.set(bucket, (levels.get(bucket) ?? 0) + 1);
  }

  // ---- trading -------------------------------------------------------------
  const allTrades: { at: number; amount: number; address: Address }[] = [];
  for (const list of store.trades.values())
    for (const t of list) allTrades.push({ at: t.at, amount: t.ethAmount, address: t.userAddress });
  const recentTrades = allTrades.filter((t) => t.at >= since);
  const volume = amountSeries(days, recentTrades);
  const tradeCount = series(days, recentTrades.map((t) => t.at));

  const feesTotal = [...store.feesByRound.values()].reduce((s, f) => s + f, 0);

  // ---- matches -------------------------------------------------------------
  const recentFinished = finished.filter((r) => (r.endedAt ?? 0) >= since);
  const matchesPerDay = series(days, recentFinished.map((r) => r.endedAt!));
  const endReasons = new Map<string, number>();
  for (const r of recentFinished) endReasons.set(r.endReason ?? "unknown", (endReasons.get(r.endReason ?? "unknown") ?? 0) + 1);
  const byMode = new Map<string, { played: number; graduated: number }>();
  for (const r of recentFinished) {
    const k = r.matchType === "pit" ? "pit" : (r.mode ?? "unlabelled");
    const e = byMode.get(k) ?? { played: 0, graduated: 0 };
    e.played++;
    if (r.graduated) e.graduated++;
    byMode.set(k, e);
  }
  const cookout = recentFinished.filter((r) => r.matchType !== "pit");
  const graduationRate = cookout.length
    ? Math.round((cookout.filter((r) => r.graduated).length / cookout.length) * 100)
    : 0;

  // ---- the Pit -------------------------------------------------------------
  const pitPlayers = players.filter((u) => u.pitStats && u.pitStats.matchesPlayed > 0);
  const pit = pitPlayers.reduce(
    (acc, u) => {
      const s = u.pitStats!;
      acc.matches += s.matchesPlayed;
      acc.predictions += s.predictionsMade;
      acc.predictionsCorrect += s.predictionsCorrect;
      acc.tradingEntries += s.tradingEntries;
      acc.tradingWins += s.tradingWins;
      acc.trials += s.trialsPlayed;
      acc.trialWins += s.trialsWon;
      acc.earnings += s.totalEarnings;
      return acc;
    },
    { matches: 0, predictions: 0, predictionsCorrect: 0, tradingEntries: 0, tradingWins: 0, trials: 0, trialWins: 0, earnings: 0 },
  );

  // ---- XP ------------------------------------------------------------------
  const xpBySource = new Map<string, number>();
  for (const u of players)
    for (const [src, amount] of Object.entries(u.xpBySource ?? {}))
      xpBySource.set(src, (xpBySource.get(src) ?? 0) + amount);
  const xpPerDay = days.map((day) => ({
    day,
    value: players.reduce((s, u) => s + ((u.dailyXp ?? {})[day] ?? 0), 0),
  }));

  // ---- BURGERS -------------------------------------------------------------
  const burgerDaily = days.map((day) => ({ day, value: store.burgerDaily?.[day] ?? 0 }));
  const burgers = {
    outstanding: players.reduce((s, u) => s + (u.burgerBalance ?? 0), 0),
    earned: players.reduce((s, u) => s + (u.burgerEarned ?? 0), 0),
    purchased: players.reduce((s, u) => s + (u.burgerPurchased ?? 0), 0),
    spent: players.reduce((s, u) => s + (u.burgerSpent ?? 0), 0),
    bySource: store.burgerBySource ?? {},
    revenueEth: store.burgerRevenueEth ?? 0,
    revenueBuckets: store.burgerRevenueBuckets ?? {},
  };

  // ---- revenue -------------------------------------------------------------
  const revenue = {
    feesLifetimeEth: feesTotal,
    jackpotPoolEth: store.jackpotPool,
    jackpotLifetimeEth: store.jackpotLifetimeEth,
    jackpotPayouts: (store.jackpotHistory ?? []).length,
    creatorFeesEth: players.reduce((s, u) => s + (u.feesEarned ?? 0), 0),
    ethUsd: store.ethUsd,
  };

  // ---- telegram ------------------------------------------------------------
  const tgRecent = store.telegramLog.filter((e) => e.at >= since);
  const telegram = {
    sent: tgRecent.filter((e) => e.kind === "sent").length,
    failed: tgRecent.filter((e) => e.kind === "failed").length,
    linked: players.filter((u) => u.telegram).length,
    perDay: series(days, tgRecent.filter((e) => e.kind === "sent").map((e) => e.at)),
  };

  // ---- leaderboards --------------------------------------------------------
  const top = (pick: (u: StoredUser) => number, n = 10) =>
    players
      .map((u) => ({ address: u.address, name: u.displayName ?? `${u.address.slice(0, 8)}…`, value: pick(u) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, n);

  return {
    range: range.days,
    generatedAt: now,
    players: {
      total: players.length,
      new: signups.reduce((s, p) => s + p.value, 0),
      dau: activeByDay.get(todayKey)?.size ?? 0,
      wau: wau.size,
      signups,
      active: dau,
      retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
      levels: [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, count]) => ({ bucket, count })),
      linkedTelegram: telegram.linked,
      founders: players.filter((u) => u.founderNumber).length,
    },
    trading: {
      volumeEth: recentTrades.reduce((s, t) => s + t.amount, 0),
      trades: recentTrades.length,
      traders: new Set(recentTrades.map((t) => t.address)).size,
      volume,
      tradeCount,
      avgTradeEth: recentTrades.length
        ? recentTrades.reduce((s, t) => s + t.amount, 0) / recentTrades.length
        : 0,
    },
    matches: {
      finished: recentFinished.length,
      live: rounds.filter((r) => r.state === "live").length,
      graduationRate,
      perDay: matchesPerDay,
      endReasons: [...endReasons.entries()].map(([reason, count]) => ({ reason, count })),
      byMode: [...byMode.entries()].map(([mode, v]) => ({ mode, ...v })),
    },
    pit: {
      ...pit,
      players: pitPlayers.length,
      predictionAccuracy: pit.predictions ? Math.round((pit.predictionsCorrect / pit.predictions) * 100) : 0,
      tradingWinRate: pit.tradingEntries ? Math.round((pit.tradingWins / pit.tradingEntries) * 100) : 0,
      trialPassRate: pit.trials ? Math.round((pit.trialWins / pit.trials) * 100) : 0,
    },
    xp: {
      perDay: xpPerDay,
      bySource: [...xpBySource.entries()].map(([source, xp]) => ({ source, xp })).sort((a, b) => b.xp - a.xp),
      total: players.reduce((s, u) => s + u.xp, 0),
    },
    burgers: { ...burgers, perDay: burgerDaily },
    revenue,
    telegram,
    leaders: {
      xp: top((u) => u.xp),
      pnl: top((u) => u.stats.totalPnl),
      trades: top((u) => u.stats.trades),
      burgers: top((u) => u.burgerEarned ?? 0),
    },
  };
}
