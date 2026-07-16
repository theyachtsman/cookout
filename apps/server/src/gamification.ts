import {
  CREATOR_FEE_SHARE,
  PODIUM_XP,
  REFERRAL_FEE_SHARE,
  XP_AWARDS,
  type Address,
  type Round,
  type RoundSummary,
} from "@cookout/shared";
import type { PlayerMeta } from "./engine.js";
import { accrueJackpot } from "./jackpot.js";
import type { Store } from "./store.js";

/**
 * Round-end resolution: builds the summary, awards XP and achievements,
 * resolves Moon-or-Rug predictions (XP only — no financial payout, spec §12),
 * and credits creator/referral fee shares (paper).
 */
export function evaluateRoundEnd(ctx: {
  store: Store;
  round: Round;
  meta: Map<Address, PlayerMeta>;
  totalVolume: number;
  peakMcap: number;
  finalMcap: number;
  finalPrice: number;
  holderCount: number;
  now: number;
}): RoundSummary {
  const { store, round, meta, now } = ctx;
  const positions = store.positions.get(round.id) ?? new Map();
  const rugged = round.endReason === "rug_detected" || round.endReason === "liquidity_removed";
  const durationSeconds = Math.max(1, Math.floor((now - (round.liveAt ?? now)) / 1000));
  const season = store.seasonKey(now);

  let winner: RoundSummary["winner"];
  let bestTrade: RoundSummary["bestTrade"];
  let biggestWhale: RoundSummary["biggestWhale"];
  let diamondHands: RoundSummary["diamondHands"];
  let fastestExit: RoundSummary["fastestExit"];
  let returnSum = 0;
  let returnCount = 0;
  const podium: Array<{ address: Address; pnl: number }> = [];

  for (const pos of positions.values()) {
    const addr = pos.userAddress as Address;
    const m = meta.get(addr);
    const user = store.getOrCreateUser(addr);
    // Served-up rounds don't mutate positions (the market stays open), so
    // battle PnL marks open tokens to the serve-up price.
    const pnl =
      pos.realizedPnl +
      (round.graduated ? pos.tokens * ctx.finalPrice - pos.costBasisEth : 0);

    podium.push({ address: addr, pnl });

    // Aggregate summary candidates.
    if (!winner || pnl > winner.pnl) winner = { address: addr, pnl };
    if (m && (!bestTrade || m.bestSellPnl > bestTrade.pnl))
      bestTrade = { address: addr, pnl: m.bestSellPnl };
    if (m && (!biggestWhale || m.biggestBuyEth > biggestWhale.ethIn))
      biggestWhale = { address: addr, ethIn: m.biggestBuyEth };
    if (m?.firstBuyAt && !m.fullExitAt) {
      const holdSeconds = Math.floor((now - m.firstBuyAt) / 1000);
      if (!diamondHands || holdSeconds > diamondHands.holdSeconds)
        diamondHands = { address: addr, holdSeconds };
    }
    if (m?.firstBuyAt && m.fullExitAt) {
      const seconds = Math.floor((m.fullExitAt - m.firstBuyAt) / 1000);
      if (!fastestExit || seconds < fastestExit.seconds) fastestExit = { address: addr, seconds };
    }

    const spent = m?.ethInvested ?? 0;
    if (spent > 0) {
      returnSum += pnl / spent;
      returnCount++;
    }

    // Per-player XP + achievements.
    const award = (kind: keyof typeof XP_AWARDS) => store.addXp(addr, XP_AWARDS[kind]);
    const grant = (id: string) => store.grantAchievement(addr, id);

    award("participation");
    if (m?.firstBuyAt) award("first_buy");
    user.stats.roundsPlayed++;
    store.trackActivity(addr, "rounds_played", 1, now);
    user.history.push({
      roundId: round.id,
      name: round.token.name,
      symbol: round.token.symbol,
      tier: round.tier,
      pnl,
      invested: m?.ethInvested ?? 0,
      endReason: round.endReason!,
      graduated: !!round.graduated,
      at: now,
    });
    if (user.history.length > 100) user.history.splice(0, user.history.length - 100);
    user.stats.totalPnl += pnl;
    if (m && m.bestSellPnl > user.stats.bestTradePnl) user.stats.bestTradePnl = m.bestSellPnl;
    const seasonStats = (user.seasons[season] ??= { pnl: 0, xp: 0, wins: 0, trades: 0 });
    seasonStats.pnl += pnl;

    const won = pnl > 0;
    if (won) {
      store.trackActivity(addr, "profitable_rounds", 1, now);
      award("win_trade");
      user.stats.wins++;
      seasonStats.wins++;
      user.stats.currentWinStreak++;
      user.stats.bestWinStreak = Math.max(user.stats.bestWinStreak, user.stats.currentWinStreak);
      if (user.stats.currentWinStreak >= 5) grant("streak_5");
    } else {
      user.stats.losses++;
      user.stats.currentWinStreak = 0;
    }

    const investedTotal = m?.ethInvested ?? 0;
    if (won && investedTotal > 0 && pnl / investedTotal >= 1) {
      award("big_winner");
      if (pnl / investedTotal >= 99) grant("hundred_x");
    }
    if (m?.soldNearPeak) {
      award("perfect_exit");
      grant("perfect_exit");
      store.trackActivity(addr, "peak_sells", 1, now);
    }
    if (m?.boughtNearBottom) {
      grant("lucky_bastard");
      store.trackActivity(addr, "dip_buys", 1, now);
    }
    if (m?.whaleHunter) {
      award("whale_hunter");
      grant("whale_hunter");
    }
    if (m?.firstBuyAt && !m.fullExitAt && now - m.firstBuyAt >= durationSeconds * 750) {
      award("diamond_hands");
      grant("diamond_hands");
      store.trackActivity(addr, "diamond_holds", 1, now);
    }
    if (m && m.firstBuyAt && m.fullExitAt && m.fullExitAt - m.firstBuyAt <= 10_000)
      grant("paper_hands");
    if (m && m.minPnlFrac <= -0.5 && won) grant("comeback_kid");
    if (rugged && m && m.maxTokens > 0 && m.tokensSoldBeforeEnd >= m.maxTokens * 0.5) {
      award("rug_survivor");
      grant("rug_survivor");
      store.trackActivity(addr, "rug_survivals", 1, now);
      user.stats.rugsSurvived++;
    }
    if (round.tier === "degen" && won) {
      award("degen_survivor");
      grant("degen_survivor");
    }
    if (round.graduated && pos.tokens > 0) {
      grant("moon_rider");
      store.trackActivity(addr, "graduations_held", 1, now);
    }
  }

  // Round podium — top 3 by PnL. Zero-sum XP (farm-proof) + a quest metric.
  const ranked = podium.filter((p) => p.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  ranked.slice(0, PODIUM_XP.length).forEach((p, i) => {
    store.addXp(p.address, PODIUM_XP[i]!);
    store.trackActivity(p.address, "podium_finishes", 1, now);
  });

  // First Blood: the round's first buyer (auction fills count via earliest firstBuyAt).
  let firstBuyer: Address | undefined;
  let firstAt = Infinity;
  for (const [addr, m] of meta) {
    if (m.firstBuyAt && m.firstBuyAt < firstAt) {
      firstAt = m.firstBuyAt;
      firstBuyer = addr;
    }
  }
  if (firstBuyer) {
    store.grantAchievement(firstBuyer, "first_blood");
    store.trackActivity(firstBuyer, "first_buys", 1, now);
  }

  // Moon-or-Rug resolution (XP only).
  const outcome: "moon" | "rug" | undefined = rugged
    ? "rug"
    : round.graduated || ctx.finalPrice >= (round.clearingPrice ?? Infinity)
      ? "moon"
      : undefined;
  const preds = store.predictions.get(round.id);
  if (preds) {
    for (const p of preds.values()) {
      const u = store.getOrCreateUser(p.userAddress);
      u.stats.predictionsMade++;
      if (outcome && p.call === outcome) {
        u.stats.predictionsCorrect++;
        store.addXp(p.userAddress, XP_AWARDS.prediction_correct);
        store.trackActivity(p.userAddress, "correct_predictions", 1, now);
        if (u.stats.predictionsCorrect >= 10) store.grantAchievement(p.userAddress, "oracle");
      }
    }
  }

  // Creator rewards: capped fee share + reputation. Rugging forfeits both.
  const creator = store.getOrCreateUser(round.creatorAddress);
  const fees = store.feesByRound.get(round.id) ?? 0;
  // Weekly Jackpot accrues from every round's fees — volume drives the pot,
  // regardless of whether the creator forfeited their share to a rug.
  accrueJackpot(store, fees);
  if (!rugged) {
    const creatorCut = fees * CREATOR_FEE_SHARE;
    creator.paperBalance += creatorCut;
    creator.feesEarned += creatorCut;
    creator.creatorReputation += round.graduated ? 2 : 1;
    if (round.graduated) {
      store.addXp(round.creatorAddress, XP_AWARDS.launched_graduate);
      store.grantAchievement(round.creatorAddress, "graduate_launcher");
    }
    if (creator.referredBy) {
      const referrer = store.users.get(creator.referredBy);
      if (referrer) {
        referrer.paperBalance += fees * REFERRAL_FEE_SHARE;
        referrer.referralEarnings += fees * REFERRAL_FEE_SHARE;
      }
    }
  } else {
    creator.creatorReputation -= 5;
  }

  return {
    roundId: round.id,
    endReason: round.endReason!,
    graduated: !!round.graduated,
    durationSeconds,
    totalVolume: ctx.totalVolume,
    peakMcap: ctx.peakMcap,
    finalMcap: ctx.finalMcap,
    holderCount: ctx.holderCount,
    averageReturnPct: returnCount > 0 ? (returnSum / returnCount) * 100 : 0,
    winner,
    topProfit: winner,
    bestTrade,
    biggestWhale,
    diamondHands,
    fastestExit,
  };
}
