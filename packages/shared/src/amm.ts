import type { PoolState } from "./types.js";

/**
 * Constant-product AMM simulation for paper-money rounds.
 * Phase 1 has no on-chain pool; this curve is the round's market. The math
 * mirrors a standard x*y=k pool so Phase 2 can swap in a real contract
 * without changing game semantics.
 */

export interface SwapResult {
  pool: PoolState;
  /** Average execution price (ETH per token) of this swap. */
  price: number;
  amountOut: number;
  fee: number;
}

export function spotPrice(pool: PoolState): number {
  return pool.ethReserve / pool.tokenReserve;
}

export function marketCap(pool: PoolState): number {
  return spotPrice(pool) * pool.totalSupply;
}

/** Tokens received for an ETH buy (fee taken from ETH in). */
export function buy(pool: PoolState, ethIn: number, feeBps: number): SwapResult {
  if (ethIn <= 0) throw new Error("ethIn must be positive");
  const fee = (ethIn * feeBps) / 10_000;
  const ethNet = ethIn - fee;
  const k = pool.ethReserve * pool.tokenReserve;
  const newEth = pool.ethReserve + ethNet;
  const newTok = k / newEth;
  const tokensOut = pool.tokenReserve - newTok;
  return {
    pool: { ...pool, ethReserve: newEth, tokenReserve: newTok },
    price: ethNet / tokensOut,
    amountOut: tokensOut,
    fee,
  };
}

/** ETH received for a token sell (fee taken from ETH out). */
export function sell(pool: PoolState, tokensIn: number, feeBps: number): SwapResult {
  if (tokensIn <= 0) throw new Error("tokensIn must be positive");
  const k = pool.ethReserve * pool.tokenReserve;
  const newTok = pool.tokenReserve + tokensIn;
  const newEth = k / newTok;
  const ethGross = pool.ethReserve - newEth;
  const fee = (ethGross * feeBps) / 10_000;
  return {
    pool: { ...pool, ethReserve: newEth, tokenReserve: newTok },
    price: ethGross / tokensIn,
    amountOut: ethGross - fee,
    fee,
  };
}

/** Tokens out for an aggregate ETH buy with no fee — used by auction clearing. */
export function tokensOutForEth(pool: PoolState, ethIn: number): number {
  if (ethIn <= 0) return 0;
  const k = pool.ethReserve * pool.tokenReserve;
  return pool.tokenReserve - k / (pool.ethReserve + ethIn);
}
