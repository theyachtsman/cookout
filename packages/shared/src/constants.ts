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
    graduationMcap: 400,
    graduationMinHolders: 10,
    graduationMinVolume: 200,
    lowVolumeThreshold: 0.5,
    lowVolumeWindowSeconds: 120,
    maxPositionEth: 5,
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
    graduationMcap: 250,
    graduationMinHolders: 8,
    graduationMinVolume: 150,
    lowVolumeThreshold: 0.5,
    lowVolumeWindowSeconds: 90,
    maxPositionEth: 8,
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
    graduationMcap: 150,
    graduationMinHolders: 5,
    graduationMinVolume: 100,
    lowVolumeThreshold: 0.25,
    lowVolumeWindowSeconds: 60,
    maxPositionEth: 0,
  },
};

/** Market-cap milestones announced in the kill feed (paper ETH). */
export const MCAP_MILESTONES = [150, 250, 400, 600, 1000];

/** Creator revenue share of round trading fees (capped — spec §5.3). */
export const CREATOR_FEE_SHARE = 0.3;

/** Referral revenue share — single tier only, no downlines (spec §11/§12). */
export const REFERRAL_FEE_SHARE = 0.1;
