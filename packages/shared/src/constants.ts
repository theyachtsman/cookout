import type { RiskTier, RoundConfig } from "./types.js";

/** Paper balance every new profile starts with (paper ETH). */
export const STARTING_PAPER_BALANCE = 10;

/** A single trade ≥ this fraction of pool ETH reserve is a "whale" event. */
export const WHALE_TRADE_FRACTION = 0.05;

/** Creator selling ≥ this fraction of their tokens in one trade flags a rug check. */
export const DEV_DUMP_FRACTION = 0.5;

/** Pool losing ≥ this fraction of ETH reserve within RUG_WINDOW_SECONDS ⇒ rug detected. */
export const RUG_DRAIN_FRACTION = 0.6;
export const RUG_WINDOW_SECONDS = 30;

/** Bonding target in USD — pump.fun-style. The pETH equivalent is computed
 *  per round at scheduling time from the live ETH/USD price. */
export const BOND_TARGET_USD = 40_000;
/** Fallback ETH/USD when the live feed is unreachable. */
export const DEFAULT_ETH_USD = 1925;

/**
 * Default round configs per risk tier (spec §7: deep/gentle → thin/steep),
 * scaled to realistic launch economics: rounds open at ~$3k–6k market cap
 * and bond at $40k, so serving up takes roughly $4–5k of net buying.
 * graduationMcap values here are fallbacks — the engine recomputes them from
 * BOND_TARGET_USD and the live ETH price when each round is scheduled.
 */
export const TIER_CONFIGS: Record<RiskTier, RoundConfig> = {
  rookie: {
    tier: "rookie",
    lobbySeconds: 120,
    queueSeconds: 90,
    maxDurationSeconds: 600,
    auctionMaxRaise: 0.75,
    initialEthLiquidity: 1.5, // opens ≈ $5.8k mcap
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: BOND_TARGET_USD / DEFAULT_ETH_USD,
    graduationMinHolders: 8,
    graduationMinVolume: 5,
    lowVolumeThreshold: 0.02,
    lowVolumeWindowSeconds: 120,
    maxPositionEth: 0.3,
    devSellLockSeconds: 60,
  },
  standard: {
    tier: "standard",
    lobbySeconds: 90,
    queueSeconds: 60,
    maxDurationSeconds: 480,
    auctionMaxRaise: 0.6,
    initialEthLiquidity: 1.0, // opens ≈ $3.8k mcap
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: BOND_TARGET_USD / DEFAULT_ETH_USD,
    graduationMinHolders: 6,
    graduationMinVolume: 4,
    lowVolumeThreshold: 0.015,
    lowVolumeWindowSeconds: 90,
    maxPositionEth: 0.5,
    devSellLockSeconds: 30,
  },
  degen: {
    tier: "degen",
    lobbySeconds: 60,
    queueSeconds: 45,
    maxDurationSeconds: 360,
    auctionMaxRaise: 0.4,
    initialEthLiquidity: 0.4, // opens ≈ $1.5k mcap — violent by design
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: BOND_TARGET_USD / DEFAULT_ETH_USD,
    graduationMinHolders: 5,
    graduationMinVolume: 2.5,
    lowVolumeThreshold: 0.01,
    lowVolumeWindowSeconds: 60,
    maxPositionEth: 0,
    devSellLockSeconds: 0,
  },
};

/** Market-cap milestones announced in the kill feed (paper ETH ≈ $10k/$19k/$29k/$40k/$58k). */
export const MCAP_MILESTONES = [5, 10, 15, 21, 30];

/** Creator revenue share of round trading fees (capped — spec §5.3). */
export const CREATOR_FEE_SHARE = 0.3;

/** Referral revenue share — single tier only, no downlines (spec §11/§12). */
export const REFERRAL_FEE_SHARE = 0.1;

/** Community voting lifecycle: a submission is auto-shortlisted at the vote
 *  threshold; if the window closes below it, the submission is rejected. */
export const VOTE_THRESHOLD = 10;
export const VOTING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Creator-chosen token supply bounds (paper units). */
export const MIN_TOKEN_SUPPLY = 100_000;
export const MAX_TOKEN_SUPPLY = 1_000_000_000;
