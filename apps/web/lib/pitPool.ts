"use client";

/**
 * Staking into a Pit match's prize pools.
 *
 * Same shape as trading: the player's own wallet pays the contract directly and
 * the server only reads what happened. Money never passes through us, which is
 * why the entry endpoint verifies against the pools rather than believing the
 * browser — and why nothing here needs the server's permission to run.
 */

import type { PitCall, PitChain } from "@cookout/shared";
import { cookoutSend, logWalletTx, signerReady } from "./cookoutWallet";

/** PitPool.Call — the contract's enum, where 0 means "unresolved". */
const CALL_CODE: Record<PitCall, number> = { graduate: 1, rug: 2, timer: 3 };

// keccak selectors for the two calls that move money.
const SEL = {
  stake: "0x604f2177", // stake(uint8)
  enter: "0xe97dcb62", // enter()
  claim: "0x4e71d92d", // claim()
  refund: "0x590e1ae3", // refund()
  openRefunds: "0x27d4ba7f", // openRefunds()
  unstake: "0x2def6620", // unstake()  — PitPool
  exit: "0xe9fad8ee", // exit()      — PitBattlePool
} as const;

const pad32 = (v: bigint | number): string => BigInt(v).toString(16).padStart(64, "0");

function ready(): void {
  if (!signerReady())
    throw new Error("Your Cookout Wallet isn't ready yet — reload and sign in again");
}

/**
 * Back a prediction with real ETH.
 *
 * Staking again on the same call adds to it, which is the contract's own
 * behaviour and matches how the paper Pit lets you raise a bet.
 */
export async function stakePrediction(
  pit: PitChain,
  call: PitCall,
  amountWei: bigint,
): Promise<string> {
  ready();
  if (amountWei <= 0n) throw new Error("stake something above zero");
  const hash = await cookoutSend(
    pit.chainId,
    pit.predictionPool as `0x${string}`,
    (SEL.stake + pad32(CALL_CODE[call])) as `0x${string}`,
    amountWei,
  );
  logWalletTx({
    hash,
    kind: "pull-up",
    eth: Number(amountWei) / 1e18,
    via: "cookout",
    chainId: pit.chainId,
    at: Date.now(),
    to: pit.predictionPool,
  });
  return hash;
}

/**
 * Pay the battle entry — exactly the tier's price, never a chosen amount.
 *
 * The contract rejects anything else, so sending the figure it was deployed
 * with is the only thing that can work. That is the fixed-entry rule enforced
 * where it cannot be argued with.
 */
export async function enterBattle(pit: PitChain): Promise<string> {
  ready();
  const entry = BigInt(pit.battleEntryWei);
  const hash = await cookoutSend(
    pit.chainId,
    pit.battlePool as `0x${string}`,
    SEL.enter as `0x${string}`,
    entry,
  );
  logWalletTx({
    hash,
    kind: "pull-up",
    eth: Number(entry) / 1e18,
    via: "cookout",
    chainId: pit.chainId,
    at: Date.now(),
    to: pit.battlePool,
  });
  return hash;
}

/**
 * Collect a win from either pool.
 *
 * Pull-based by design, so this is the only way winnings move — nobody can
 * push them, and nobody else can trigger the claim.
 */
export async function claimPitPool(
  pit: PitChain,
  which: "prediction" | "battle",
): Promise<string> {
  ready();
  const pool = which === "prediction" ? pit.predictionPool : pit.battlePool;
  const hash = await cookoutSend(pit.chainId, pool as `0x${string}`, SEL.claim as `0x${string}`);
  logWalletTx({ hash, kind: "claim", eth: 0, via: "cookout", chainId: pit.chainId, at: Date.now() });
  return hash;
}

/**
 * Take a stake back from a match nobody resolved.
 *
 * `openRefunds` is permissionless and only works after the 24-hour window, so
 * this is the player's own escape hatch — it needs no cooperation from us, and
 * a UI that never exposed it would make the guarantee theoretical.
 */
export async function refundPitPool(
  pit: PitChain,
  which: "prediction" | "battle",
  alreadyOpen: boolean,
): Promise<string> {
  ready();
  const pool = (which === "prediction" ? pit.predictionPool : pit.battlePool) as `0x${string}`;
  if (!alreadyOpen) await cookoutSend(pit.chainId, pool, SEL.openRefunds as `0x${string}`);
  const hash = await cookoutSend(pit.chainId, pool, SEL.refund as `0x${string}`);
  logWalletTx({ hash, kind: "claim", eth: 0, via: "cookout", chainId: pit.chainId, at: Date.now() });
  return hash;
}

/**
 * Pull a bet back out before the match starts.
 *
 * The paper Pit has always allowed this while the lobby is open, so the chain
 * version must too — otherwise "withdraw" clears the entry on our side while
 * the pool keeps the money, and the next attempt to enter is rejected because
 * as far as the contract is concerned they never left.
 *
 * Each call is attempted independently: a player who only backed one of the
 * two pools should not have their exit blocked by the other having nothing to
 * return.
 */
export async function leavePitPools(
  pit: PitChain,
  opts: { prediction: boolean; battle: boolean },
): Promise<void> {
  ready();
  const errors: string[] = [];
  const attempt = async (label: string, pool: string, sel: string) => {
    try {
      const hash = await cookoutSend(pit.chainId, pool as `0x${string}`, sel as `0x${string}`);
      logWalletTx({ hash, kind: "cancel", eth: 0, via: "cookout", chainId: pit.chainId, at: Date.now() });
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
    }
  };
  if (opts.prediction) await attempt("prediction", pit.predictionPool, SEL.unstake);
  if (opts.battle) await attempt("battle", pit.battlePool, SEL.exit);
  // Only a total failure is worth surfacing: one empty pool is normal.
  if (errors.length === (opts.prediction ? 1 : 0) + (opts.battle ? 1 : 0) && errors.length > 0)
    throw new Error(errors[0]!);
}

/** USD → wei at the current peg, for prediction stakes (the battle is fixed). */
export function stakeWei(usd: number, ethUsd: number): bigint {
  if (!(usd > 0) || !(ethUsd > 0)) throw new Error("bad stake");
  return BigInt(Math.round((usd / ethUsd) * 1e18));
}
