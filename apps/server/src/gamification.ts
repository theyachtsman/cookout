import {
  CREATOR_FEE_SHARE,
  PODIUM_XP,
  REFERRAL_FEE_SHARE,
  XP_AWARDS,
  isEnduranceMode,
  type Address,
  type Round,
  type RoundSummary,
} from "@cookout/shared";
import type { PlayerMeta } from "./engine.js";
import { accrueJackpot } from "./jackpot.js";
import { awardBurger, awardBurgerOneTime } from "./burger.js";
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

  // Endurance has its own progression track. It has no clock, so its rewards
  // key off real elapsed time and conviction rather than round-relative
  // percentages: hours held, riding a launch to its bond, and staying in
  // (profitably) after the dev sold their own bag.
  const endurance = isEnduranceMode(round.mode);
  const devSold = (meta.get(round.creatorAddress)?.tokensSoldBeforeEnd ?? 0) > 0;
  const HOUR = 3_600_000;

  let winner: RoundSummary["winner"];
  let bestTrade: RoundSummary["bestTrade"];
  let biggestWhale: RoundSummary["biggestWhale"];
  let diamondHands: RoundSummary["diamondHands"];
  let fastestExit: RoundSummary["fastestExit"];
  let returnSum = 0;
  let returnCount = 0;
  const podium: Array<{ address: Address; pnl: number }> = [];

  // Snapshot each trader's XP before this round's end-of-round awards, so the
  // results scoreboard can rank by XP earned THIS round. Trade XP was already
  // added live (tracked per-player in meta), so it's added back in below.
  const xpBefore = new Map<Address, number>();
  for (const pos of positions.values())
    xpBefore.set(pos.userAddress as Address, store.getOrCreateUser(pos.userAddress as Address).xp);

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

    // Participation & first-buy are "floor" XP (attendance) — weekly-capped.
    store.addXp(addr, XP_AWARDS.participation, "floor");
    if (m?.firstBuyAt) store.addXp(addr, XP_AWARDS.first_buy, "floor");
    user.stats.roundsPlayed++;
    store.trackActivity(addr, "rounds_played", 1, now);
    store.bumpPlayStreak(addr, now); // daily play streak (idempotent per day)
    // Burger economy: reward completing the match (not trading), plus the
    // one-time First Match milestone. Bots are ignored inside the service.
    awardBurger(store, addr, "match_complete", { ref: round.id, now });
    awardBurgerOneTime(store, addr, "first_match", now);
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

    // ---- Endurance progression ----
    if (endurance) {
      const st = user.stats;
      st.enduranceRounds = (st.enduranceRounds ?? 0) + 1;
      store.trackActivity(addr, "endurance_played", 1, now);
      grant("endurance_initiate");
      if (st.enduranceRounds >= 25) grant("endurance_veteran");
      if (won) store.trackActivity(addr, "endurance_profit", 1, now);

      // Time actually held, in wall-clock terms — the whole point of a mode
      // with no clock. An open position is held right up to the end.
      if (m?.firstBuyAt) {
        const heldMs = (m.fullExitAt ?? now) - m.firstBuyAt;
        st.longestEnduranceHoldSeconds = Math.max(
          st.longestEnduranceHoldSeconds ?? 0,
          Math.floor(heldMs / 1000),
        );
        if (heldMs >= HOUR) {
          award("endurance_long_hold");
          grant("long_hauler");
          store.trackActivity(addr, "endurance_long_holds", 1, now);
        }
        if (heldMs >= 24 * HOUR) {
          award("endurance_marathon");
          grant("marathon_runner");
        }
      }

      // Rode it all the way to the bonding curve, still holding at the bell.
      if (round.graduated && pos.tokens > 0) {
        st.enduranceBonds = (st.enduranceBonds ?? 0) + 1;
        award("endurance_bond");
        grant("went_the_distance");
        store.trackActivity(addr, "endurance_bonds", 1, now);
      }

      // Conviction: the dev dumped their own bag and you still came out ahead.
      if (devSold && won && addr !== round.creatorAddress) {
        award("endurance_unshaken");
        grant("unshaken");
      }
    }

    // Lifetime milestone ladders (trades / rounds / cumulative PnL).
    store.checkMilestones(addr);
  }

  // Round podium — top 3 by PnL. Zero-sum XP (farm-proof) + a quest metric.
  const ranked = podium.filter((p) => p.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  ranked.slice(0, PODIUM_XP.length).forEach((p, i) => {
    store.addXp(p.address, PODIUM_XP[i]!);
    store.trackActivity(p.address, "podium_finishes", 1, now);
  });

  // Season pass last, so this round's full XP (incl. podium/streaks) counts.
  for (const p of podium) store.checkSeasonPass(p.address);

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
  // regardless of whether the creator forfeited their share to a rug. The same
  // fees + volume feed this week's site totals (shown on the jackpot page).
  accrueJackpot(store, fees);
  store.accrueWeeklyTotals(ctx.totalVolume, fees, now);
  if (!rugged) {
    const creatorCut = fees * CREATOR_FEE_SHARE;
    // Creator fees land in the creator's Cook Out balance (and show in the
    // wallet's history ledger), not the bank.
    creator.arenaBalance = (creator.arenaBalance ?? 0) + creatorCut;
    creator.feesEarned += creatorCut;
    if (creatorCut > 0)
      store.recordLedger(creator.address, "creator_fee", creatorCut, { symbol: round.token.symbol, roundId: round.id });
    creator.creatorReputation += round.graduated ? 2 : 1;
    if (round.graduated) {
      store.addXp(round.creatorAddress, XP_AWARDS.launched_graduate);
      store.grantAchievement(round.creatorAddress, "graduate_launcher");
      // Taking a coin all the way to the bond with no clock forcing the issue
      // is the hardest thing a creator can do here — its own legendary.
      if (endurance) store.grantAchievement(round.creatorAddress, "endurance_launcher");
      // Burger economy: graduating a coin pays the creator + First Graduation.
      awardBurger(store, round.creatorAddress, "coin_graduation", { ref: round.id, now });
      awardBurgerOneTime(store, round.creatorAddress, "first_graduation", now);
    }
    if (creator.referredBy) {
      const referrer = store.users.get(creator.referredBy);
      if (referrer) {
        referrer.paperBalance += fees * REFERRAL_FEE_SHARE;
        referrer.referralEarnings += fees * REFERRAL_FEE_SHARE;
      }
    }
  } else if (round.blitz || round.config.rugRules === false) {
    // Rug rules off (Blitz/Reflex): the pull IS the game. If a round somehow
    // ends rugged here (e.g. an admin liquidity pull), it costs the creator
    // nothing — no reputation hit, no launch ban.
    store.logAdmin("blitz_rug", `${creator.address} rugged $${round.token.symbol} (rug rules off · no penalty)`);
  } else {
    creator.creatorReputation -= 5;
    // A rug is a launch ban, not just a score hit. Self-serve mode (paper
    // beta) issues an open-ended ban the player clears from their own
    // profile; wait-out mode stamps an expiry from the escalation schedule —
    // repeat offenses wait longer.
    const bans = (creator.rugBans ??= []);
    const offense = bans.length + 1;
    const sched = store.settings.rugBanHours;
    const hours = sched[Math.min(offense - 1, sched.length - 1)] ?? 24;
    bans.push({
      at: now,
      roundId: round.id,
      symbol: round.token.symbol,
      tier: round.tier,
      offense,
      expiresAt: store.settings.selfServeUnban ? undefined : now + hours * 3_600_000,
    });
    store.logAdmin(
      "rug_ban",
      `${creator.address} banned from launching (offense #${offense}, $${round.token.symbol})`,
    );
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
    // Final standings for the results scoreboard: everyone who traded, ranked by
    // XP earned this round (trade XP + this round's end-of-round awards), capped
    // so the summary (and its snapshot) stays lean.
    leaderboard: podium
      .map((p) => {
        const before = xpBefore.get(p.address);
        const endXp = before === undefined ? 0 : store.getOrCreateUser(p.address).xp - before;
        const xp = (meta.get(p.address)?.tradeXpEarned ?? 0) + endXp;
        return { address: p.address, xp, pnl: p.pnl };
      })
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10),
  };
}
