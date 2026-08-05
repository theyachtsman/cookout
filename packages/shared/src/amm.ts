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

// ---------------------------------------------------------------------------
// Exact on-chain quotes (wei)
// ---------------------------------------------------------------------------

/**
 * Integer mirrors of RoundPool.buy/sell, in wei.
 *
 * Separate from the float functions above on purpose. Those model the paper
 * game, where being a rounding error out costs nothing. These price a real
 * transaction: a quote even one wei above what the contract will actually pay
 * out becomes a minimum-out that reverts an honest trade, and float math on
 * 1e18-scale reserves cannot promise that. Every operation here — including
 * the truncating divisions — matches the Solidity exactly.
 */

const BPS_WEI = 10_000n;

export interface ChainReserves {
  ethReserve: bigint;
  tokenReserve: bigint;
}

/** Tokens out for an ETH buy. Mirrors RoundPool.buy (fee off the ETH in). */
export function quoteBuyWei(r: ChainReserves, valueWei: bigint, tradeFeeBps: number): bigint {
  if (valueWei <= 0n || r.ethReserve <= 0n || r.tokenReserve <= 0n) return 0n;
  const fee = (valueWei * BigInt(tradeFeeBps)) / BPS_WEI;
  const net = valueWei - fee;
  const k = r.ethReserve * r.tokenReserve;
  return r.tokenReserve - k / (r.ethReserve + net);
}

/** ETH out for a token sell. Mirrors RoundPool.sell (fee off the ETH out). */
export function quoteSellWei(r: ChainReserves, tokensInWei: bigint, tradeFeeBps: number): bigint {
  if (tokensInWei <= 0n || r.ethReserve <= 0n || r.tokenReserve <= 0n) return 0n;
  const k = r.ethReserve * r.tokenReserve;
  const newTokenReserve = r.tokenReserve + tokensInWei;
  const newEthReserve = k / newTokenReserve;
  const grossOut = r.ethReserve - newEthReserve;
  const fee = (grossOut * BigInt(tradeFeeBps)) / BPS_WEI;
  return grossOut - fee;
}

/** Default trade tolerance. Thin launch curves move fast; 1% is the usual
 *  starting point and the player can change it. */
export const DEFAULT_SLIPPAGE_BPS = 100;
/** Above this a "tolerance" stops protecting anything worth protecting. */
export const MAX_SLIPPAGE_BPS = 2_000;

/**
 * Turn a quote into the minimum the trade will accept.
 *
 * This is the number that makes a sandwich unprofitable: the attacker can only
 * move the price by the tolerance before the victim's trade reverts instead of
 * filling at a price they never agreed to.
 */
export function minOutWei(quoteWei: bigint, slippageBps: number): bigint {
  const bps = Math.min(Math.max(Math.round(slippageBps), 0), MAX_SLIPPAGE_BPS);
  return (quoteWei * BigInt(10_000 - bps)) / BPS_WEI;
}
