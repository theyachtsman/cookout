import { tokensOutForEth } from "./amm.js";
import { sha256Hex } from "./sha256.js";
import type { AuctionFill, AuctionIntent, AuctionResult, PoolState } from "./types.js";

/**
 * Uniform-price batch auction with pro-rata oversubscription handling.
 *
 * Fairness properties (see spec §6):
 * - Every fill settles at ONE clearing price. Submission order is irrelevant.
 * - Oversubscription is resolved pro-rata, never by price priority or
 *   queue position, so neither speed nor bid aggressiveness buys priority.
 * - The computation is a pure function of (intents, pool, maxRaise) and the
 *   result carries a deterministic audit hash, so anyone can recompute and
 *   verify the settlement.
 *
 * Model: the auction executes one aggregate buy of A paper-ETH against the
 * round's initial curve. The clearing price is the average execution price
 * p(A) = A / tokensOut(A), which is strictly increasing in A. Demand
 * D(p) = sum of intent amounts whose limit allows price p (market intents
 * always included), which is non-increasing in p. We binary-search the
 * fixed point A* = min(D(p(A*)), maxRaise), then fill every eligible
 * intent at fill ratio A* over eligible demand D.
 */
export function settleAuction(params: {
  roundId: string;
  intents: AuctionIntent[];
  pool: PoolState;
  maxRaise: number;
  feeBps: number;
  now?: number;
}): AuctionResult {
  const { roundId, intents, pool, maxRaise, feeBps } = params;
  const now = params.now ?? Date.now();

  const totalDemand = intents.reduce((s, i) => s + i.ethAmount, 0);

  const demandAt = (price: number): number =>
    intents.reduce(
      (s, i) => s + (i.maxPrice === undefined || i.maxPrice >= price ? i.ethAmount : 0),
      0,
    );

  // Settlement fee is taken from filled ETH before it reaches the curve, so
  // the price users pay per token (gross of fee) is what limit checks see.
  const feeFrac = feeBps / 10_000;
  const priceAt = (raise: number): number => {
    if (raise <= 0) return pool.ethReserve / pool.tokenReserve; // spot
    return raise / tokensOutForEth(pool, raise * (1 - feeFrac));
  };

  // g(A) = min(D(p(A)), maxRaise) is non-increasing in A; find largest A ≤ g(A).
  let lo = 0;
  let hi = Math.min(totalDemand, maxRaise);
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2;
    const g = Math.min(demandAt(priceAt(mid)), maxRaise);
    if (mid <= g) lo = mid;
    else hi = mid;
  }
  const raised = lo;

  const clearingPrice = priceAt(raised);
  const eligible = intents.filter(
    (i) => i.maxPrice === undefined || i.maxPrice >= clearingPrice,
  );
  const eligibleDemand = eligible.reduce((s, i) => s + i.ethAmount, 0);
  const fillRatio = eligibleDemand > 0 ? Math.min(1, raised / eligibleDemand) : 0;

  const raisedNet = raised * (1 - feeFrac);
  const totalTokens = tokensOutForEth(pool, raisedNet);
  const fills: AuctionFill[] = intents.map((i) => {
    const isEligible = i.maxPrice === undefined || i.maxPrice >= clearingPrice;
    const ethFilled = isEligible ? i.ethAmount * fillRatio : 0;
    const tokensOut =
      raised > 0 && ethFilled > 0 ? (ethFilled / raised) * totalTokens : 0;
    return {
      intentId: i.id,
      userAddress: i.userAddress,
      ethIn: i.ethAmount,
      ethFilled,
      tokensOut,
      refund: i.ethAmount - ethFilled,
    };
  });

  const poolAfter: PoolState = {
    ...pool,
    ethReserve: pool.ethReserve + raisedNet,
    tokenReserve: pool.tokenReserve - totalTokens,
  };

  const auditHash = sha256Hex(
    JSON.stringify({
        roundId,
        pool,
        maxRaise,
        feeBps,
        intents: [...intents]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((i) => [i.id, i.userAddress, i.ethAmount, i.maxPrice ?? null]),
        clearingPrice,
        raised,
        fills: [...fills]
          .sort((a, b) => a.intentId.localeCompare(b.intentId))
          .map((f) => [f.intentId, f.ethFilled, f.tokensOut]),
    }),
  );

  return {
    roundId,
    clearingPrice,
    totalDemand,
    totalRaised: raised,
    fillRatio,
    fills,
    poolAfter,
    settledAt: now,
    auditHash,
  };
}
