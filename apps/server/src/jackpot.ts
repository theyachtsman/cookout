import {
  COSMETICS,
  CREATOR_FEE_SHARE,
  JACKPOT_FEE_SHARE,
  JACKPOT_PAYOUT_WEIGHTS,
  JACKPOT_WINNERS,
  REFERRAL_FEE_SHARE,
  nextWeekStart,
  weekKey,
  type JackpotPayout,
  type JackpotStanding,
  type JackpotStatus,
} from "@cookout/shared";
import type { Store, StoredUser } from "./store.js";

/**
 * The Weekly Jackpot: a volume-driven reward pool. A fixed slice of every
 * round's trading fees (JACKPOT_FEE_SHARE) accrues to a site-wide pot; each
 * week it pays out to the top players by XP earned that week, split by
 * JACKPOT_PAYOUT_WEIGHTS. Phase 1 pays in paper ETH by crediting balances;
 * production would pay real ETH to the winning addresses at the same seam
 * (see settleWeeklyJackpot's credit loop) — the accounting is identical.
 */

/** Add a round's jackpot slice from its total trading fees. Returns the cut. */
export function accrueJackpot(store: Store, roundFees: number): number {
  const cut = roundFees > 0 ? roundFees * JACKPOT_FEE_SHARE : 0;
  if (cut > 0) store.jackpotPool += cut;
  return cut;
}

function badgeFor(u: StoredUser): string | undefined {
  return COSMETICS.find((c) => c.id === u.equipped.badge)?.value;
}

/** Top XP earners for a week, highest first, capped at JACKPOT_WINNERS. */
function rankByWeeklyXp(store: Store, week: string): StoredUser[] {
  return [...store.users.values()]
    .filter((u) => (u.weeklyXp[week] ?? 0) > 0)
    .sort((a, b) => (b.weeklyXp[week] ?? 0) - (a.weeklyXp[week] ?? 0))
    .slice(0, JACKPOT_WINNERS);
}

/** Winner rows with each rank's slice of `pool` (projected or final). */
function buildStandings(store: Store, week: string, pool: number, ethUsd: number): JackpotStanding[] {
  return rankByWeeklyXp(store, week).map((u, i) => {
    const amountEth = pool * JACKPOT_PAYOUT_WEIGHTS[i]!;
    return {
      rank: i + 1,
      address: u.address,
      displayName: u.displayName,
      level: u.level,
      title: u.title,
      badge: badgeFor(u),
      weeklyXp: u.weeklyXp[week] ?? 0,
      amountEth,
      amountUsd: amountEth * ethUsd,
    };
  });
}

/**
 * Pay out the jackpot if the ISO week has rolled over since the pool started
 * accruing. Idempotent within a week (returns null until the week changes),
 * and safe across multi-week downtime — it settles the stored week and jumps
 * to the current one. Ranks left unfilled (fewer than 10 qualifiers) keep
 * their slice in the pot, which rolls into the new week. No-op-safe to call
 * every tick.
 */
export function settleWeeklyJackpot(store: Store, now = Date.now()): JackpotPayout | null {
  const current = weekKey(now);
  if (current === store.jackpotWeekKey) return null;

  const settledWeek = store.jackpotWeekKey;
  const pool = store.jackpotPool;
  const ethUsd = store.ethUsd;
  const winners = buildStandings(store, settledWeek, pool, ethUsd);

  let paid = 0;
  for (const w of winners) {
    const u = store.getOrCreateUser(w.address);
    u.paperBalance += w.amountEth; // Phase 1: paper payout. Production: send ETH here.
    u.jackpotWinnings = (u.jackpotWinnings ?? 0) + w.amountEth;
    (u.jackpotWins ??= []).push({
      week: settledWeek,
      rank: w.rank,
      amountEth: w.amountEth,
      amountUsd: w.amountUsd,
      at: now,
    });
    paid += w.amountEth;
  }

  // Advance the accrual week; any unpaid remainder rolls forward.
  store.jackpotWeekKey = current;
  store.jackpotPool = pool - paid;
  store.jackpotLifetimeEth += paid;

  if (paid <= 0) return null;
  const payout: JackpotPayout = {
    week: settledWeek,
    paidAt: now,
    totalEth: paid,
    totalUsd: paid * ethUsd,
    ethUsd,
    winners,
  };
  store.jackpotHistory.push(payout);
  return payout;
}

/** Full jackpot snapshot for the site (GET /api/jackpot). */
export function jackpotStatus(store: Store, now = Date.now()): JackpotStatus {
  const week = store.jackpotWeekKey;
  const pool = store.jackpotPool;
  const ethUsd = store.ethUsd;
  const creatorPct = Math.round(CREATOR_FEE_SHARE * 100);
  const referralPct = Math.round(REFERRAL_FEE_SHARE * 100);
  const jackpotPct = Math.round(JACKPOT_FEE_SHARE * 100);
  return {
    week,
    poolEth: pool,
    poolUsd: pool * ethUsd,
    ethUsd,
    paperMode: process.env.JACKPOT_ONCHAIN !== "1" && process.env.CHAIN_ONLY !== "1",
    breakdown: {
      creatorPct,
      referralPct,
      jackpotPct,
      housePct: 100 - creatorPct - referralPct - jackpotPct,
    },
    payoutWeights: [...JACKPOT_PAYOUT_WEIGHTS],
    nextPayoutAt: nextWeekStart(now),
    lifetimePaidEth: store.jackpotLifetimeEth,
    standings: buildStandings(store, week, pool, ethUsd),
    lastPayout: store.jackpotHistory[store.jackpotHistory.length - 1] ?? null,
    history: store.jackpotHistory.slice(-8).reverse(),
  };
}
