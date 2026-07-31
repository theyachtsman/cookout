/**
 * The Pit's end-of-match resolution (spec: Prediction Market + Trading pool).
 *
 * Prediction is a betting market with two winner groups that split the (net)
 * prediction pool by an admin-configured allocation:
 *  - Main prediction (graduate / rug / timer) — correct callers split the Main
 *    bucket pro-rata to their wager.
 *  - House Special (the featured rotating side bet) — if it hits, everyone who
 *    entered it splits the House bucket pro-rata to their wager.
 * Calling BOTH correctly earns the Double Down Bonus.
 *
 * Trading is a race against the other traders: the highest PnL takes the trading
 * pool. Unclaimed money in any bucket funds the weekly jackpot. Bots never earn.
 */
import { marketCap, type HouseSpecialKind, type PitCall, type PitPlayerResult, type PitResult, type Round, type RoundSummary } from "@cookout/shared";
import type { Store } from "./store.js";
import { houseStakeOf, mainStakeOf, tradingStakeOf } from "./pit-pools.js";

export interface PitResolveCtx {
  totalVolume: number;
  peakMcap: number;
  finalMcap: number;
  finalPrice: number;
  holderCount: number;
  now: number;
}

const isBot = (a: string) => a.startsWith("0xb07");

/** The Main outcome the match resolved to, from its end state. */
export function pitOutcome(round: Round): PitCall {
  if (round.graduated) return "graduate";
  if (round.endReason === "rug_detected" || round.endReason === "liquidity_removed") return "rug";
  return "timer";
}

/** Whether the featured House Special condition was met this match. */
export function houseSpecialHit(round: Round, ctx: PitResolveCtx, kind: HouseSpecialKind): boolean {
  const cfg = round.config;
  const liveAt = round.liveAt ?? 0;
  const endedAt = round.endedAt ?? ctx.now;
  const total = Math.max(1, cfg.maxDurationSeconds * 1000);
  const elapsedMs = Math.max(0, endedAt - liveAt);
  const frac = Math.min(1, elapsedMs / total);
  const rug = round.endReason === "rug_detected" || round.endReason === "liquidity_removed";
  const graduated = !!round.graduated;
  const timer = !rug && !graduated;
  const openMcap = marketCap({
    ethReserve: cfg.initialEthLiquidity,
    tokenReserve: cfg.initialTokenLiquidity,
    totalSupply: cfg.totalSupply,
  });
  const grad = cfg.graduationMcap;
  switch (kind) {
    case "early_rug":
      return rug && frac <= 0.34;
    case "late_rug":
      return rug && frac >= 0.66;
    case "flash_rug":
      return rug && elapsedMs <= 15_000;
    case "whale_rug":
      return rug && ctx.peakMcap >= openMcap * 2;
    case "early_graduate":
      return graduated && frac <= 0.5;
    case "photo_finish":
      return (graduated && frac >= 0.8) || (timer && ctx.finalMcap >= grad * 0.9);
    case "bull_timer":
      return timer && ctx.finalMcap > openMcap;
    case "dead_market":
      return timer && ctx.finalMcap <= openMcap;
    default:
      return false;
  }
}

/** Skim + route the Pit fee (jackpot / creator / platform+treasury). */
function routeFee(store: Store, round: Round, fee: number): void {
  if (fee <= 1e-12) return;
  const pit = round.pit!;
  store.jackpotPool += fee * pit.feeSplit.jackpot;
  const creatorCut = fee * pit.feeSplit.creator;
  if (creatorCut > 0 && !round.creatorAddress.startsWith("0xb07")) {
    const creator = store.getOrCreateUser(round.creatorAddress);
    creator.arenaBalance = (creator.arenaBalance ?? 0) + creatorCut;
    creator.feesEarned += creatorCut;
    store.recordLedger(round.creatorAddress, "pit_creator", creatorCut, { symbol: round.token.symbol, roundId: round.id });
  }
  store.feesByRound.set(round.id, (store.feesByRound.get(round.id) ?? 0) + fee * (pit.feeSplit.platform + pit.feeSplit.treasury));
}

export function resolvePitRound(store: Store, round: Round, ctx: PitResolveCtx): RoundSummary {
  const pit = round.pit!;
  const outcome = pitOutcome(round);
  const carryEnabled = store.settings.pit.carryover;
  const entries = store.pitEntriesFor(round.id);
  const positions = store.positions.get(round.id) ?? new Map();
  const houseHit = pit.houseSpecial ? houseSpecialHit(round, ctx, pit.houseSpecial.kind) : false;

  // Skim the Pit fee off the gross pools, then work with the net.
  const feeRate = pit.pitFeeBps / 10_000;
  const predFee = pit.prediction.pot * feeRate;
  const tradeFee = pit.trading.pot * feeRate;
  routeFee(store, round, predFee + tradeFee);
  const netPred = pit.prediction.pot - predFee;
  const netTrade = pit.trading.pot - tradeFee;

  // Winner groups + trading PnL.
  const mainWinStake = new Map<string, number>();
  const houseWinStake = new Map<string, number>();
  const traderPnl = new Map<string, number>();
  for (const [addr, entry] of entries) {
    if (isBot(addr)) continue;
    if (entry.prediction === outcome) mainWinStake.set(addr, mainStakeOf(round, entry));
    if (entry.houseSpecial && houseHit) houseWinStake.set(addr, houseStakeOf(round, entry));
    if (entry.trading) {
      const held = positions.get(addr)?.tokens ?? 0;
      traderPnl.set(addr, store.pitStackOf(round.id, addr) + held * ctx.finalPrice - pit.startingStack);
    }
  }
  // Trading: the human trader(s) with the highest PnL win the pool (ties split).
  const roundTrades = store.trades.get(round.id) ?? [];
  const tradeCountOf = (addr: string) => roundTrades.reduce((n, t) => (t.userAddress === addr ? n + 1 : n), 0);
  let qualifiers: string[] = [];
  if (traderPnl.size > 0) {
    const best = Math.max(...traderPnl.values());
    qualifiers = [...traderPnl.entries()].filter(([, pnl]) => pnl >= best - 1e-12).map(([a]) => a);
  }

  // Split the net prediction pool into the two buckets. If only one group has
  // participants, it takes the whole net pool.
  const hasMain = pit.mainParticipants > 0;
  const hasHouse = !!pit.houseSpecial && pit.houseParticipants > 0;
  let mainBucket = 0;
  let houseBucket = 0;
  if (hasMain && hasHouse) {
    mainBucket = (netPred * pit.mainAllocationBps) / 10_000;
    houseBucket = (netPred * pit.houseAllocationBps) / 10_000;
  } else if (hasMain) {
    mainBucket = netPred;
  } else if (hasHouse) {
    houseBucket = netPred;
  }

  const totalMainStake = [...mainWinStake.values()].reduce((s, v) => s + v, 0);
  const totalHouseStake = [...houseWinStake.values()].reduce((s, v) => s + v, 0);
  const tradeReward = qualifiers.length ? netTrade / qualifiers.length : 0;

  const mainCarried = mainBucket > 1e-9 && mainWinStake.size === 0;
  const houseCarried = houseBucket > 1e-9 && houseWinStake.size === 0;
  const tradeCarried = netTrade > 1e-9 && qualifiers.length === 0;
  if (carryEnabled) {
    if (mainCarried) store.jackpotPool += mainBucket;
    if (houseCarried) store.jackpotPool += houseBucket;
    if (tradeCarried) store.jackpotPool += netTrade;
  }

  const qualified = new Set(qualifiers);
  const players: PitPlayerResult[] = [];
  let doubleDownCount = 0;

  for (const [addr, entry] of entries) {
    if (isBot(addr)) continue;
    const u = store.getOrCreateUser(addr);
    const wonMain = mainWinStake.has(addr);
    const wonHouse = houseWinStake.has(addr);
    const isQual = entry.trading ? qualified.has(addr) : undefined;

    const predictionReward = wonMain && totalMainStake > 0 ? mainBucket * (mainStakeOf(round, entry) / totalMainStake) : 0;
    const houseSpecialReward = wonHouse && totalHouseStake > 0 ? houseBucket * (houseStakeOf(round, entry) / totalHouseStake) : 0;
    const doubleDownBonus = wonMain && wonHouse ? pit.doubleDownBonus : 0;
    if (doubleDownBonus > 0) doubleDownCount += 1;
    const tradingReward = isQual ? tradeReward : 0;
    const totalReward = predictionReward + houseSpecialReward + doubleDownBonus + tradingReward;
    const feesPaid = mainStakeOf(round, entry) + houseStakeOf(round, entry) + tradingStakeOf(round, entry);
    const pnl = entry.trading ? (traderPnl.get(addr) ?? 0) : undefined;
    const wonPrediction = wonMain || wonHouse;
    const doubleWinner = wonPrediction && !!isQual;

    if (totalReward > 0) {
      u.arenaBalance = (u.arenaBalance ?? 0) + totalReward;
      store.recordLedger(addr, "pit_reward", totalReward, { symbol: round.token.symbol, roundId: round.id });
    }

    // Lifetime Pit record.
    const ps = store.pitStatsOf(addr);
    ps.matchesPlayed += 1;
    ps.byDuration[pit.duration].played += 1;
    if (entry.prediction || entry.houseSpecial) ps.predictionMarketsPlayed += 1;
    if (entry.prediction) {
      ps.predictionsMade += 1;
      ps.predictionStaked += mainStakeOf(round, entry);
      if (entry.prediction === outcome) ps.predictionsCorrect += 1;
    }
    if (wonMain) ps.predictionWins += 1;
    ps.predictionEarnings += predictionReward;
    if (entry.houseSpecial) {
      ps.houseEntered += 1;
      ps.houseStaked += houseStakeOf(round, entry);
    }
    if (wonHouse) ps.houseWins += 1;
    ps.houseEarnings += houseSpecialReward;
    if (doubleDownBonus > 0) {
      ps.doubleDowns += 1;
      if (doubleDownBonus > ps.largestDoubleDown) ps.largestDoubleDown = doubleDownBonus;
    }
    if (entry.trading) {
      ps.tradingEntries += 1;
      ps.tradingStaked += tradingStakeOf(round, entry);
      const p = pnl ?? 0;
      ps.totalPnl += p;
      if (p > ps.highestPnl) ps.highestPnl = p;
      if (isQual) {
        ps.tradingWins += 1;
        ps.currentProfitStreak += 1;
        if (ps.currentProfitStreak > ps.longestProfitStreak) ps.longestProfitStreak = ps.currentProfitStreak;
      } else {
        ps.currentProfitStreak = 0;
      }
    }
    if (doubleWinner) ps.doubleWins += 1;
    if (wonPrediction || isQual) ps.byDuration[pit.duration].wins += 1;
    if (totalReward > ps.largestWin) ps.largestWin = totalReward;
    ps.totalEarnings += totalReward;

    // Shared leveling (counts toward the profile + weekly jackpot).
    let xp = 10;
    if (wonMain) xp += 20;
    if (wonHouse) xp += 15;
    if (doubleDownBonus > 0) xp += 20;
    if (isQual) xp += 25;
    store.addXp(addr, xp, "ceiling", "pit");

    store.trackActivity(addr, "pit_played", 1, ctx.now);
    if (wonMain) store.trackActivity(addr, "pit_predictions_correct", 1, ctx.now);
    if (isQual) store.trackActivity(addr, "pit_trading_wins", 1, ctx.now);
    if (doubleWinner) store.trackActivity(addr, "pit_double_wins", 1, ctx.now);
    store.grantAchievement(addr, "pit_initiate");
    if (wonMain) store.grantAchievement(addr, "pit_oracle");
    if (isQual) store.grantAchievement(addr, "swarm_slayer");
    if (doubleWinner) store.grantAchievement(addr, "double_winner");
    if (ps.matchesPlayed >= 25) store.grantAchievement(addr, "pit_veteran");
    if (ps.tradingWins >= 25) store.grantAchievement(addr, "swarm_nemesis");

    players.push({
      address: addr,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      prediction: entry.prediction,
      predictionCorrect: entry.prediction ? entry.prediction === outcome : undefined,
      predictionReward,
      houseSpecial: entry.houseSpecial,
      houseSpecialCorrect: entry.houseSpecial ? houseHit : undefined,
      houseSpecialReward,
      doubleDownBonus,
      tradingPnl: pnl,
      qualified: isQual,
      trades: entry.trading ? tradeCountOf(addr) : undefined,
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
    houseSpecial: pit.houseSpecial ? { def: pit.houseSpecial, hit: houseHit } : undefined,
    prediction: {
      pot: mainBucket,
      winners: mainWinStake.size,
      rewardEach: mainWinStake.size ? mainBucket / mainWinStake.size : 0,
      carried: mainCarried,
    },
    house: {
      pot: houseBucket,
      winners: houseWinStake.size,
      rewardEach: houseWinStake.size ? houseBucket / houseWinStake.size : 0,
      carried: houseCarried,
    },
    doubleDown: { bonus: pit.doubleDownBonus, count: doubleDownCount },
    trading: {
      pot: netTrade,
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
