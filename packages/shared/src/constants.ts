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

/** Default round configs per risk tier (spec §7: deep/gentle → thin/steep). */
export const TIER_CONFIGS: Record<RiskTier, RoundConfig> = {
  rookie: {
    tier: "rookie",
    lobbySeconds: 120,
    queueSeconds: 90,
    maxDurationSeconds: 600,
    auctionMaxRaise: 50,
    initialEthLiquidity: 100,
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: 2400,
    graduationMinHolders: 20,
    graduationMinVolume: 500,
    lowVolumeThreshold: 0.5,
    lowVolumeWindowSeconds: 120,
    maxPositionEth: 5,
    devSellLockSeconds: 60,
  },
  standard: {
    tier: "standard",
    lobbySeconds: 90,
    queueSeconds: 60,
    maxDurationSeconds: 480,
    auctionMaxRaise: 40,
    initialEthLiquidity: 40,
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: 1000,
    graduationMinHolders: 15,
    graduationMinVolume: 300,
    lowVolumeThreshold: 0.5,
    lowVolumeWindowSeconds: 90,
    maxPositionEth: 8,
    devSellLockSeconds: 30,
  },
  degen: {
    tier: "degen",
    lobbySeconds: 60,
    queueSeconds: 45,
    maxDurationSeconds: 360,
    auctionMaxRaise: 30,
    initialEthLiquidity: 10,
    initialTokenLiquidity: 1_000_000,
    totalSupply: 2_000_000,
    tradeFeeBps: 100,
    auctionFeeBps: 50,
    mcapTarget: 0,
    graduationMcap: 250,
    graduationMinHolders: 10,
    graduationMinVolume: 150,
    lowVolumeThreshold: 0.25,
    lowVolumeWindowSeconds: 60,
    maxPositionEth: 0,
    devSellLockSeconds: 0,
  },
};

/** Market-cap milestones announced in the kill feed (paper ETH). */
export const MCAP_MILESTONES = [150, 250, 400, 600, 1000, 1600, 2400];

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
