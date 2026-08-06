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
import { marketCap, trialTierFor, type HouseSpecialKind, type PitCall, type PitPlayerResult, type PitResult, type Round, type RoundSummary } from "@cookout/shared";
import type { Store } from "./store.js";
import { houseStakeOf, mainStakeOf, tradingStakeOf, trialStakeOf } from "./pit-pools.js";

export interface PitResolveCtx {
  totalVolume: number;
  peakMcap: number;
  finalMcap: number;
  finalPrice: number;
  holderCount: number;
  now: number;
  /** Worst unrealized drawdown fraction per player (from live meta), for the
   *  "no losing position" Trial achievement. */
  drawdown?: Map<string, number>;
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

/**
 * The single player who takes an on-chain battle pot.
 *
 * The paper pool splits between everyone tied at the best PnL. A winner-take-all
 * contract cannot split, so a tie has to be broken by something — and it has to
 * be something a player can check for themselves rather than take on trust.
 *
 * Highest PnL first, then whoever traded most (they worked harder for the same
 * number), then the lowest address. The last step is arbitrary, and it is meant
 * to be: an arbitrary rule fixed in advance beats a judgement call made by the
 * house after seeing who it would favour.
 */
export function battleWinnerOf(
  store: Store,
  round: Round,
  pnlByTrader: Map<string, number>,
  /** Restrict to one tier's entrants — each tier is its own pot. */
  tier?: string,
): string | undefined {
  if (tier) {
    const inTier = new Map(
      [...pnlByTrader].filter(([addr]) => store.pitEntryOf(round.id, addr as never)?.battleTier === tier),
    );
    if (inTier.size === 0) return undefined;
    pnlByTrader = inTier;
  }
  if (pnlByTrader.size === 0) return undefined;
  const trades = store.trades.get(round.id) ?? [];
  const tradeCount = (addr: string) => trades.reduce((n, t) => (t.userAddress === addr ? n + 1 : n), 0);
  return [...pnlByTrader.entries()]
    .sort(([aAddr, aPnl], [bAddr, bPnl]) => {
      if (Math.abs(aPnl - bPnl) > 1e-12) return bPnl - aPnl;
      const byTrades = tradeCount(bAddr) - tradeCount(aAddr);
      if (byTrades !== 0) return byTrades;
      return aAddr.localeCompare(bAddr);
    })[0]?.[0];
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

/** Route forfeited money as house revenue with NO creator cut — used for lost
 *  Flame Trial stakes, since the creator is the sole player and must never earn
 *  from their own solo run. The creator's normal share folds into the house. */
function routeHouse(store: Store, round: Round, amount: number): void {
  if (amount <= 1e-12) return;
  const pit = round.pit!;
  store.jackpotPool += amount * pit.feeSplit.jackpot;
  const house = amount * (pit.feeSplit.platform + pit.feeSplit.treasury + pit.feeSplit.creator);
  store.feesByRound.set(round.id, (store.feesByRound.get(round.id) ?? 0) + house);
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
  // Flame Trial stakes are settled per player below: refunded on a win, forfeited
  // to the house (never the creator) on a loss. So they are NOT routed here.
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
  let trialPassedCount = 0;
  // Solo trials have one player; surface that player's tier bar in the summary.
  let trialSummaryRequiredBps = pit.trialRequiredPnlBps;

  for (const [addr, entry] of entries) {
    if (isBot(addr)) continue;
    const u = store.getOrCreateUser(addr);
    const wonMain = mainWinStake.has(addr);
    const wonHouse = houseWinStake.has(addr);
    const isQual = entry.trading ? qualified.has(addr) : undefined;

    // Flame Trial: score the solo objective. The stake picks a tier, and the tier
    // sets the PnL bar — a bigger stake means a higher bar to clear (and, on a
    // pass, more XP + rarer cosmetics).
    let trialPnlPct: number | undefined;
    let trialTierName: string | undefined;
    let trialPassed: boolean | undefined;
    let trialXpAwarded: number | undefined;
    let trialRequiredBps: number | undefined;
    if (entry.trial) {
      const held = positions.get(addr)?.tokens ?? 0;
      const tpnl = store.pitStackOf(round.id, addr) + held * ctx.finalPrice - pit.startingStack;
      trialPnlPct = pit.startingStack > 0 ? tpnl / pit.startingStack : 0;
      const tier = trialTierFor((entry.trialStake ?? 0) * store.ethUsd, pit.trialTiers);
      trialRequiredBps = tier.requiredPnlBps ?? pit.trialRequiredPnlBps;
      trialPassed = trialPnlPct * 10_000 >= trialRequiredBps - 1e-9;
      trialTierName = tier.name;
    }

    const predictionReward = wonMain && totalMainStake > 0 ? mainBucket * (mainStakeOf(round, entry) / totalMainStake) : 0;
    const houseSpecialReward = wonHouse && totalHouseStake > 0 ? houseBucket * (houseStakeOf(round, entry) / totalHouseStake) : 0;
    const doubleDownBonus = wonMain && wonHouse ? pit.doubleDownBonus : 0;
    if (doubleDownBonus > 0) doubleDownCount += 1;
    const tradingReward = isQual ? tradeReward : 0;
    const totalReward = predictionReward + houseSpecialReward + doubleDownBonus + tradingReward;
    const feesPaid =
      mainStakeOf(round, entry) + houseStakeOf(round, entry) + tradingStakeOf(round, entry) + trialStakeOf(round, entry);
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
    // Flame Trial settlement + progression. Stake the coin: pass and you get the
    // stake back plus your tier's rewards (XP, titles, badges); miss the bar and
    // the stake is forfeited to the house. Never a Cook Out Balance profit, and
    // the creator earns no fee from their own solo run.
    let trialRefund = 0;
    if (entry.trial) {
      const stake = trialStakeOf(round, entry);
      trialSummaryRequiredBps = trialRequiredBps ?? pit.trialRequiredPnlBps;
      ps.trialsPlayed += 1;
      if ((trialPnlPct ?? 0) > ps.highestTrialPnlPct) ps.highestTrialPnlPct = trialPnlPct ?? 0;
      const tier = trialTierFor((entry.trialStake ?? 0) * store.ethUsd, pit.trialTiers);
      store.grantAchievement(addr, "first_flame");
      store.trackActivity(addr, "trial_played", 1, ctx.now);
      if (trialPassed) {
        // Return the staked coin in full — no house cut on a win.
        trialRefund = stake;
        if (stake > 0) {
          u.arenaBalance = (u.arenaBalance ?? 0) + stake;
          store.recordLedger(addr, "pit_trial", stake, { symbol: round.token.symbol, roundId: round.id });
        }
        trialPassedCount += 1;
        trialXpAwarded = tier.xp;
        ps.trialsWon += 1;
        ps.trialXp += tier.xp;
        ps.trialWinStreak += 1;
        if (ps.trialWinStreak > ps.bestTrialWinStreak) ps.bestTrialWinStreak = ps.trialWinStreak;
        // Highest tier completed (by USD threshold).
        const prevMin = pit.trialTiers.find((t) => t.name === ps.highestTrialTier)?.minUsd ?? -1;
        if (tier.minUsd > prevMin) ps.highestTrialTier = tier.name;
        store.addXp(addr, tier.xp, "ceiling", "pit");
        store.trackActivity(addr, "trial_won", 1, ctx.now);
        store.trackActivity(addr, "trial_target_hit", 1, ctx.now);
        if (ps.trialsWon >= 10) store.grantAchievement(addr, "heat_resistant");
        if (ps.trialsWon >= 50) store.grantAchievement(addr, "fireproof");
        if ((ctx.drawdown?.get(addr) ?? -1) >= -1e-6) store.grantAchievement(addr, "untouchable");
        if (tier.name === "Mythic") store.grantAchievement(addr, "legend_hunter");
        store.pushActivity(
          addr,
          "won",
          `passed a ${tier.name} Flame Trial (+${Math.round((trialPnlPct ?? 0) * 100)}%)`,
          { roundId: round.id, roundSymbol: round.token.symbol },
        );
      } else {
        // Missed the bar: the stake is gone, routed to the house (no creator cut).
        routeHouse(store, round, stake);
        ps.trialWinStreak = 0;
        store.addXp(addr, 10, "ceiling", "pit"); // participation
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
    if (!entry.trial) store.addXp(addr, xp, "ceiling", "pit");

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
      trades: entry.trading || entry.trial ? tradeCountOf(addr) : undefined,
      tradingReward,
      trial: entry.trial,
      trialStake: entry.trial ? entry.trialStake : undefined,
      trialPnlPct,
      trialTier: trialTierName,
      trialRequiredBps: trialRequiredBps,
      trialPassed,
      trialXp: trialXpAwarded,
      totalReward,
      // A passed trial returns the stake, so its net cash effect is zero.
      net: totalReward + trialRefund - feesPaid,
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
      // Who a winner-take-all on-chain pot pays, per tier: each is its own
      // pot, so the best PnL among that tier's entrants wins it — not the
      // match's best overall, who may have been playing for a different stake.
      winner: battleWinnerOf(store, round, traderPnl),
      winnerByTier: Object.fromEntries(
        (["easy", "medium", "hard"] as const)
          .map((t) => [t, battleWinnerOf(store, round, traderPnl, t)])
          .filter(([, w]) => w),
      ) as Record<string, string>,
    },
    trial: {
      participants: pit.trialParticipants,
      passed: trialPassedCount,
      requiredPnlBps: trialSummaryRequiredBps,
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

  // The Flame Goon Squad calls the winner — in the match room and, for a marquee
  // result, the general Pit room. An underdog trading win reads as an upset.
  const champ = players[0];
  if (champ && (champ.totalReward > 0 || champ.trialPassed)) {
    const upset = !!champ.qualified && (champ.trades ?? 0) <= 3;
    const moment = { kind: (upset ? "upset" : "winner") as "upset" | "winner", symbol: round.token.symbol, winner: champ.displayName ?? "someone", now: ctx.now };
    store.onPitMoment({ ...moment, roomId: round.id });
    store.onPitMoment({ ...moment, roomId: "pit" });
  }
  return summary;
}
