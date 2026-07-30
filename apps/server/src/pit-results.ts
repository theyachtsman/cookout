/**
 * The Pit's end-of-match resolution (spec: Match Outcomes + Prize Distribution).
 *
 * Two independent competitions settle here:
 *  - Prediction Pool — everyone who called the actual outcome (graduate / rug /
 *    timer) splits that pool evenly.
 *  - Trading Pool — everyone who finished their paper stack in profit (positive
 *    PnL) splits that pool evenly.
 * A player who wins both is a Double Winner. If nobody qualifies for a pool, it
 * carries into the next Pit match. Bots (0xb07…) never earn a reward.
 */
import type { PitCall, PitPlayerResult, PitResult, Round, RoundSummary } from "@cookout/shared";
import type { Store } from "./store.js";

export interface PitResolveCtx {
  totalVolume: number;
  peakMcap: number;
  finalMcap: number;
  finalPrice: number;
  holderCount: number;
  now: number;
}

const isBot = (a: string) => a.startsWith("0xb07");

/** The outcome the match resolved to, from its end state. */
export function pitOutcome(round: Round): PitCall {
  if (round.graduated) return "graduate";
  if (round.endReason === "rug_detected" || round.endReason === "liquidity_removed") return "rug";
  return "timer";
}

export function resolvePitRound(store: Store, round: Round, ctx: PitResolveCtx): RoundSummary {
  const pit = round.pit!;
  const outcome = pitOutcome(round);
  const carryEnabled = store.settings.pit.carryover;
  const entries = store.pitEntriesFor(round.id);
  const positions = store.positions.get(round.id) ?? new Map();

  // Trading PnL per human entrant: remaining stack + held tokens at the final
  // price, minus the starting stack.
  const traderPnl = new Map<string, number>();
  const predWinners: string[] = [];
  for (const [addr, entry] of entries) {
    if (isBot(addr)) continue;
    if (entry.prediction === outcome) predWinners.push(addr);
    if (entry.trading) {
      const held = positions.get(addr)?.tokens ?? 0;
      const value = store.pitStackOf(round.id, addr) + held * ctx.finalPrice;
      traderPnl.set(addr, value - pit.startingStack);
    }
  }
  const qualifiers = [...traderPnl.entries()].filter(([, pnl]) => pnl > 0).map(([a]) => a);

  const predPot = pit.prediction.pot + pit.prediction.carryIn;
  const tradePot = pit.trading.pot + pit.trading.carryIn;
  const predReward = predWinners.length ? predPot / predWinners.length : 0;
  const tradeReward = qualifiers.length ? tradePot / qualifiers.length : 0;
  const predCarried = predWinners.length === 0 && predPot > 1e-9 && carryEnabled;
  const tradeCarried = qualifiers.length === 0 && tradePot > 1e-9 && carryEnabled;
  if (predCarried) store.pitCarry.prediction += predPot;
  if (tradeCarried) store.pitCarry.trading += tradePot;

  const predWon = new Set(predWinners);
  const qualified = new Set(qualifiers);
  const hadCarryIn = pit.prediction.carryIn > 1e-9 || pit.trading.carryIn > 1e-9;

  const players: PitPlayerResult[] = [];
  for (const [addr, entry] of entries) {
    if (isBot(addr)) continue;
    const u = store.getOrCreateUser(addr);
    const wonPred = predWon.has(addr);
    const isQual = entry.trading ? qualified.has(addr) : undefined;
    const predictionReward = wonPred ? predReward : 0;
    const tradingReward = isQual ? tradeReward : 0;
    const totalReward = predictionReward + tradingReward;
    const feesPaid =
      (entry.prediction ? pit.predictionFee : 0) + (entry.trading ? pit.tradingFee : 0);
    const pnl = entry.trading ? (traderPnl.get(addr) ?? 0) : undefined;
    const doubleWinner = wonPred && !!isQual;

    if (totalReward > 0) {
      u.arenaBalance = (u.arenaBalance ?? 0) + totalReward;
      store.recordLedger(addr, "pit_reward", totalReward, {
        symbol: round.token.symbol,
        roundId: round.id,
      });
    }

    // Lifetime Pit record.
    const ps = store.pitStatsOf(addr);
    ps.matchesPlayed += 1;
    ps.byDuration[pit.duration].played += 1;
    if (entry.prediction) {
      ps.predictionsMade += 1;
      if (entry.prediction === outcome) ps.predictionsCorrect += 1;
    }
    if (wonPred) ps.predictionWins += 1;
    if (entry.trading) {
      ps.tradingEntries += 1;
      const p = pnl ?? 0;
      ps.totalPnl += p;
      if (p > ps.highestPnl) ps.highestPnl = p;
      if (isQual) {
        ps.tradingWins += 1;
        ps.currentProfitStreak += 1;
        if (ps.currentProfitStreak > ps.longestProfitStreak)
          ps.longestProfitStreak = ps.currentProfitStreak;
      } else {
        ps.currentProfitStreak = 0;
      }
    }
    if (doubleWinner) ps.doubleWins += 1;
    if (wonPred || isQual) ps.byDuration[pit.duration].wins += 1;
    if (totalReward > ps.largestWin) ps.largestWin = totalReward;
    ps.totalEarnings += totalReward;
    if (totalReward > 0 && hadCarryIn) ps.carryoverWins += 1;

    // Shared leveling: participation plus a bonus for each win.
    let xp = 10;
    if (wonPred) xp += 25;
    if (isQual) xp += 25;
    if (doubleWinner) xp += 25;
    store.addXp(addr, xp, "ceiling");

    players.push({
      address: addr,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      prediction: entry.prediction,
      predictionCorrect: entry.prediction ? entry.prediction === outcome : undefined,
      tradingPnl: pnl,
      qualified: isQual,
      predictionReward,
      tradingReward,
      totalReward,
      net: totalReward - feesPaid,
      doubleWinner,
    });
  }
  players.sort((a, b) => b.totalReward - a.totalReward);

  const pitResult: PitResult = {
    duration: pit.duration,
    outcome,
    prediction: {
      pot: predPot,
      winners: predWinners.length,
      rewardEach: predReward,
      carried: predCarried,
    },
    trading: {
      pot: tradePot,
      qualified: qualifiers.length,
      rewardEach: tradeReward,
      carried: tradeCarried,
    },
    players,
  };

  const summary: RoundSummary = {
    roundId: round.id,
    endReason: round.endReason ?? "timer",
    graduated: !!round.graduated,
    durationSeconds: Math.floor((ctx.now - (round.liveAt ?? ctx.now)) / 1000),
    totalVolume: ctx.totalVolume,
    peakMcap: ctx.peakMcap,
    finalMcap: ctx.finalMcap,
    holderCount: ctx.holderCount,
    averageReturnPct: 0,
    pit: pitResult,
  };
  const topTrader = [...traderPnl.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTrader) summary.topProfit = { address: topTrader[0], pnl: topTrader[1] };
  return summary;
}
