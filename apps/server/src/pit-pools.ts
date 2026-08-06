/**
 * The Pit's prize-pool bookkeeping (spec: Prediction Market + Trading pool).
 *
 * Prediction is a real betting market: each player places a Main prediction and,
 * optionally, the featured House Special side bet — each with a player-chosen
 * wager (min/max bounded). All prediction money pools together and is held GROSS
 * through the lobby, so a player can edit or withdraw cleanly until the round
 * goes live. The Pit fee is skimmed once, at settlement (pit-results.ts).
 */
import type { Address, PitEntry, Round } from "@cookout/shared";
import type { Store } from "./store.js";

/** The Main prediction wager for an entry (clamped to config min bet). */
export function mainStakeOf(round: Round, entry: PitEntry): number {
  const pit = round.pit!;
  return entry.prediction ? Math.max(pit.minBet, entry.predictionStake ?? pit.minBet) : 0;
}

/** The House Special wager for an entry. */
export function houseStakeOf(round: Round, entry: PitEntry): number {
  const pit = round.pit!;
  return entry.houseSpecial ? Math.max(pit.minBet, entry.houseSpecialStake ?? pit.minBet) : 0;
}

/** The trading buy-in for an entry (defaults to the base fee). */
export function tradingStakeOf(round: Round, entry: PitEntry): number {
  const pit = round.pit!;
  return entry.trading ? (entry.tradingStake ?? pit.tradingFee) : 0;
}

/** The Flame Trial entry stake for an entry (a challenge cost, no prize pool). */
export function trialStakeOf(_round: Round, entry: PitEntry): number {
  return entry.trial ? (entry.trialStake ?? 0) : 0;
}

/** Total pETH an entry costs (predictions + trading buy-in + Trial stake). */
export function pitEntryCost(round: Round, entry: PitEntry): number {
  return (
    mainStakeOf(round, entry) +
    houseStakeOf(round, entry) +
    tradingStakeOf(round, entry) +
    trialStakeOf(round, entry)
  );
}

/** Refund and remove a player's current entry (edit/withdraw during the lobby). */
export function withdrawPit(store: Store, round: Round, address: Address): void {
  const pit = round.pit!;
  const addr = address.toLowerCase();
  const entry = store.pitEntryOf(round.id, addr);
  if (!entry) return;
  const user = store.getOrCreateUser(addr);
  const bot = addr.startsWith("0xb07");
  // A chain stake is in the pool contract, not in a balance we control. There
  // is no unstake before close, so the pot bookkeeping unwinds but no paper
  // money moves — crediting it here would mint pETH out of an on-chain bet.
  const onChain = !!round.pitChain;
  const credit = (amount: number) => {
    if (onChain || amount <= 0) return;
    user.arenaBalance = (user.arenaBalance ?? 0) + amount;
  };

  const main = mainStakeOf(round, entry);
  const house = houseStakeOf(round, entry);
  const trade = tradingStakeOf(round, entry);
  const trial = trialStakeOf(round, entry);
  const predRefund = main + house;

  if (predRefund > 0) {
    credit(predRefund);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_prediction", predRefund, { symbol: round.token.symbol, roundId: round.id });
    pit.prediction.pot -= predRefund;
    pit.prediction.participants = Math.max(0, pit.prediction.participants - 1);
    if (entry.prediction) pit.mainParticipants = Math.max(0, pit.mainParticipants - 1);
    if (entry.houseSpecial) pit.houseParticipants = Math.max(0, pit.houseParticipants - 1);
  }
  if (trade > 0) {
    credit(trade);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_trading", trade, { symbol: round.token.symbol, roundId: round.id });
    pit.trading.pot -= trade;
    pit.trading.participants = Math.max(0, pit.trading.participants - 1);
  }
  if (trial > 0) {
    credit(trial);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_trial", trial, { symbol: round.token.symbol, roundId: round.id });
    pit.trialParticipants = Math.max(0, pit.trialParticipants - 1);
  }
  // Both trading and Trial hand out a paper stack — clear it on withdrawal.
  store.setPitStack(round.id, addr, 0);
  store.pitEntriesFor(round.id).delete(addr);
}

/**
 * Place (or replace) a player's Pit entry. Any existing entry is refunded first
 * so this doubles as an edit. Money is held gross; the caller has validated the
 * pools are enabled, the wagers are within bounds, and the player can afford it.
 */
export function enterPit(store: Store, round: Round, address: Address, entry: PitEntry): void {
  const pit = round.pit!;
  const addr = address.toLowerCase();
  withdrawPit(store, round, addr); // replace any existing entry
  const user = store.getOrCreateUser(addr);
  const bot = addr.startsWith("0xb07");
  // On a chain match the money is already escrowed in the pool contracts —
  // the player sent it there themselves before we ever saw this entry. Taking
  // it from their paper balance too would charge them twice for one bet. The
  // pot still tracks it, because the game's own maths runs off these numbers
  // whether or not there is a contract behind them.
  const onChain = !!round.pitChain;
  const debit = (amount: number) => {
    if (onChain || amount <= 0) return;
    user.arenaBalance = (user.arenaBalance ?? 0) - amount;
  };

  const main = mainStakeOf(round, entry);
  const house = houseStakeOf(round, entry);
  const trade = tradingStakeOf(round, entry);
  const trial = trialStakeOf(round, entry);
  const predTotal = main + house;

  if (predTotal > 0) {
    debit(predTotal);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_prediction", -predTotal, { symbol: round.token.symbol, roundId: round.id });
    pit.prediction.pot += predTotal;
    pit.prediction.participants += 1;
    if (entry.prediction) pit.mainParticipants += 1;
    if (entry.houseSpecial) pit.houseParticipants += 1;
  }
  if (trade > 0) {
    debit(trade);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_trading", -trade, { symbol: round.token.symbol, roundId: round.id });
    pit.trading.pot += trade;
    pit.trading.participants += 1;
  }
  if (trial > 0) {
    debit(trial);
    if (!bot && !onChain)
      store.recordLedger(addr, "pit_trial", -trial, { symbol: round.token.symbol, roundId: round.id });
    pit.trialParticipants += 1;
  }
  // Trading and Trial both trade a paper stack against the Goon Squad.
  if (entry.trading || entry.trial) store.setPitStack(round.id, addr, pit.startingStack);
  store.setPitEntry(round.id, addr, entry);
}
