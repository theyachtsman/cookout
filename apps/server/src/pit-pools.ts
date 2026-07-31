/**
 * The Pit's prize-pool bookkeeping (spec: Prize Pools + Entry Fees).
 *
 * Two independent pools per match — Prediction and Trading. A player pays an
 * entry fee from their Cook Out balance; the Pit fee is skimmed off the top and
 * routed (platform / weekly jackpot / creator / treasury); the remainder funds
 * the pool they entered. Pools are paid out (or carried over) at resolution by
 * pit-results.ts. Nothing here touches the chain — The Pit is paper-only.
 */
import type { Address, PitEntry, Round } from "@cookout/shared";
import type { Store } from "./store.js";

/** The prediction stake for an entry (custom bet, defaulting to the base fee). */
export function predictionStakeOf(round: Round, entry: PitEntry): number {
  const pit = round.pit!;
  return entry.prediction ? (entry.predictionStake ?? pit.predictionFee) : 0;
}

/** The trading buy-in for an entry (custom bet, defaulting to the base fee). */
export function tradingStakeOf(round: Round, entry: PitEntry): number {
  const pit = round.pit!;
  return entry.trading ? (entry.tradingStake ?? pit.tradingFee) : 0;
}

/** Total pETH an entry costs (prediction stake + trading buy-in). */
export function pitEntryCost(round: Round, entry: PitEntry): number {
  return predictionStakeOf(round, entry) + tradingStakeOf(round, entry);
}

/**
 * Take a player's Pit entry: debit the fee(s), skim + route the Pit fee, and
 * fund the selected pool(s). The caller has already validated that the player
 * hasn't entered yet, chose at least one pool, and can afford it.
 */
export function enterPit(store: Store, round: Round, address: Address, entry: PitEntry): void {
  const pit = round.pit!;
  const addr = address.toLowerCase();
  const user = store.getOrCreateUser(addr);
  const bot = addr.startsWith("0xb07");

  /** Skim the Pit fee off a gross entry, route it, and return the net for the pool. */
  const skim = (gross: number): number => {
    const fee = (gross * pit.pitFeeBps) / 10_000;
    if (fee <= 0) return gross;
    store.jackpotPool += fee * pit.feeSplit.jackpot;
    const creatorCut = fee * pit.feeSplit.creator;
    if (creatorCut > 0 && round.creatorAddress !== addr && !round.creatorAddress.startsWith("0xb07")) {
      const creator = store.getOrCreateUser(round.creatorAddress);
      creator.arenaBalance = (creator.arenaBalance ?? 0) + creatorCut;
      creator.feesEarned += creatorCut;
      store.recordLedger(round.creatorAddress, "pit_creator", creatorCut, {
        symbol: round.token.symbol,
        roundId: round.id,
      });
    }
    // Platform + treasury are house revenue, tracked as this round's fees.
    store.feesByRound.set(
      round.id,
      (store.feesByRound.get(round.id) ?? 0) + fee * (pit.feeSplit.platform + pit.feeSplit.treasury),
    );
    return gross - fee;
  };

  if (entry.prediction) {
    // Parimutuel prediction bet: the player's custom stake (>= the base fee).
    const gross = entry.predictionStake ?? pit.predictionFee;
    user.arenaBalance = (user.arenaBalance ?? 0) - gross;
    if (!bot) {
      store.recordLedger(addr, "pit_prediction", -gross, { symbol: round.token.symbol, roundId: round.id });
      store.pitStatsOf(addr).predictionStaked += gross;
    }
    pit.prediction.pot += skim(gross);
    pit.prediction.participants += 1;
  }
  if (entry.trading) {
    // Custom parimutuel buy-in (>= the base fee); the traded stack stays equal.
    const gross = entry.tradingStake ?? pit.tradingFee;
    user.arenaBalance = (user.arenaBalance ?? 0) - gross;
    if (!bot) {
      store.recordLedger(addr, "pit_trading", -gross, { symbol: round.token.symbol, roundId: round.id });
      store.pitStatsOf(addr).tradingStaked += gross;
    }
    pit.trading.pot += skim(gross);
    pit.trading.participants += 1;
    // Hand out the equal paper stack immediately so the lobby shows the bankroll.
    store.setPitStack(round.id, addr, pit.startingStack);
  }
  store.setPitEntry(round.id, addr, entry);
}
