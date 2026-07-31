import type { CoinModifiers, GameMode, HouseSpecialDef, HouseSpecialKind, NotifyCategory, NotificationPrefs, PitBonusType, PitDurationKey, PitFeeSplit, RiskTier, RoundConfig, TrialTier } from "./types.js";

/** Total permanent Founding Member seats. Founder numbers never repeat. */
export const FOUNDER_CAP = 500;

/**
 * The Telegram notification switches, in display order. `feed` items also post
 * to the community channel; the rest are personal DMs from The Pit Boss.
 */
export const NOTIFY_CATEGORIES: {
  key: NotifyCategory;
  label: string;
  desc: string;
  group: "you" | "community";
}[] = [
  { key: "levelUps", label: "Level ups", desc: "When you reach a new level", group: "you" },
  { key: "titles", label: "New titles", desc: "When you earn a new title", group: "you" },
  { key: "achievements", label: "Achievements", desc: "Badges you unlock", group: "you" },
  { key: "quests", label: "Quests", desc: "Quests and missions completed", group: "you" },
  { key: "streaks", label: "Streaks", desc: "Daily play-streak milestones", group: "you" },
  { key: "leaderboard", label: "Leaderboard moves", desc: "When you gain or lose a rank", group: "you" },
  { key: "reputation", label: "Reputation", desc: "Creator reputation changes", group: "you" },
  { key: "launchBans", label: "Launch bans", desc: "Bans and when they clear", group: "you" },
  { key: "followedPlayers", label: "Players you follow", desc: "Big moments from people you follow", group: "you" },
  { key: "jackpot", label: "Jackpot", desc: "Jackpot growth and payouts", group: "community" },
  { key: "votingMilestones", label: "Voting", desc: "Coins hitting the vote bar", group: "community" },
  { key: "fairOpen", label: "Fair Open", desc: "Auctions opening and settling", group: "community" },
  { key: "trading", label: "Trading opens", desc: "When a round goes live", group: "community" },
  { key: "graduations", label: "Graduations", desc: "Coins that serve up", group: "community" },
  { key: "rugs", label: "Burns & rugs", desc: "Coins that get burnt", group: "community" },
  { key: "runItBack", label: "Run It Back", desc: "Failed coins relaunching", group: "community" },
  { key: "patchNotes", label: "Patch notes", desc: "Product updates", group: "community" },
  { key: "announcements", label: "Announcements", desc: "Official announcements", group: "community" },
];

/** Every switch on by default — players opt out, not in. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = NOTIFY_CATEGORIES.reduce(
  (acc, c) => ((acc[c.key] = true), acc),
  {} as NotificationPrefs,
);

/** Resolve a player's effective prefs (stored partial over the defaults). */
export function resolveNotifyPrefs(p?: Partial<NotificationPrefs>): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(p ?? {}) };
}

/** Paper balance every new profile starts with (paper ETH). */
export const STARTING_PAPER_BALANCE = 10;

/** A single trade ≥ this fraction of pool ETH reserve is a "whale" event. */
export const WHALE_TRADE_FRACTION = 0.05;

/** A launch counts as a rug once the creator has sold ≥ this fraction of the
 *  most they ever held of their own coin (cumulative across all their sells,
 *  not a single trade). Selling under this is just profit-taking. */
export const DEV_DUMP_FRACTION = 0.75;

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
/** Creator-selectable live-trading lengths for a match, in minutes. */
export const MATCH_MINUTE_OPTIONS = [10, 7, 5, 1] as const;

/**
 * The four curated launch modes (plus a reserved fifth). The launchpad shows
 * these as a single, guided choice instead of a tier + duration matrix — clean
 * onboarding, fast mastery. Each mode bundles a live-trading length and whether
 * rug mechanics apply, over a base economics tier:
 *
 *  - Classic  — 10m, standard rules. The balanced default.
 *  - Pressure —  7m, standard rules. A tighter clock for max tension.
 *  - Blitz    —  5m, rug rules OFF. Thin, violent, high-energy.
 *  - Reflex   —  1m, rug rules OFF. Pure dopamine chaos.
 *  - Endurance — no timer. Listed but disabled until a later unlock.
 */
export interface GameModeDef {
  key: GameMode;
  name: string;
  /** Live-trading minutes; null = no timer (Endurance). */
  minutes: number | null;
  /** Whether rug mechanics apply (dev-dump auto-rug, drain detector, sell lock). */
  rugRules: boolean;
  /** Base economics tier the mode runs on. */
  tier: RiskTier;
  /** The Fair Open cap (pETH): the most the batch auction accepts at the open.
   *  Fixed per mode and shown at launch. Beyond it, pull-ups fill pro-rata. */
  pullUpCap: number;
  /** One-line label under the mode name. */
  tagline: string;
  /** The longer sell. */
  blurb: string;
  /** Level required to launch in this mode. */
  unlockLevel: number;
  /** Listed in the picker but not yet launchable. */
  disabled?: boolean;
}

export const GAME_MODES: GameModeDef[] = [
  {
    key: "classic",
    name: "Classic",
    minutes: 10,
    rugRules: true,
    tier: "standard",
    pullUpCap: 1.5,
    unlockLevel: 1,
    tagline: "10 min · standard rules",
    blurb: "The balanced match: ten minutes, full rules, real crowds. The default way to cook.",
  },
  {
    key: "pressure",
    name: "Pressure",
    minutes: 7,
    rugRules: true,
    tier: "standard",
    pullUpCap: 1.25,
    unlockLevel: 1,
    tagline: "7 min · standard rules",
    blurb:
      "Same rules on a tighter seven-minute clock. Less room to breathe, so it's all tension and skill expression.",
  },
  {
    key: "blitz",
    name: "Blitz",
    minutes: 5,
    rugRules: false,
    tier: "degen",
    pullUpCap: 1.0,
    unlockLevel: 1,
    tagline: "5 min · rug rules off",
    blurb:
      "Five minutes, no rug mechanics, thin liquidity. Aggressive, high-energy, violent price action.",
  },
  {
    key: "reflex",
    name: "Reflex",
    minutes: 1,
    rugRules: false,
    tier: "degen",
    pullUpCap: 0.75,
    unlockLevel: 1,
    tagline: "1 min · rug rules off",
    blurb: "Sixty seconds. No rug rules, no safety net. Pure dopamine, and it's over before you blink.",
  },
  {
    key: "endurance",
    name: "Endurance",
    minutes: null,
    rugRules: true,
    tier: "standard",
    pullUpCap: 2.0,
    unlockLevel: 999,
    tagline: "No timer · coming soon",
    blurb: "A marathon with no clock that runs until the market decides. Reserved for a later unlock.",
    disabled: true,
  },
];

export const GAME_MODE_MAP: Record<GameMode, GameModeDef> = Object.fromEntries(
  GAME_MODES.map((m) => [m.key, m]),
) as Record<GameMode, GameModeDef>;

/** The launchpad's default selection. */
export const DEFAULT_GAME_MODE: GameMode = "classic";

/**
 * Mode modifiers — optional toggles a creator layers on top of a game mode at
 * launch. Kept as a list so the launchpad can render them generically and more
 * can be added later.
 */
export interface ModifierDef {
  key: keyof CoinModifiers;
  name: string;
  icon: string;
  tagline: string;
  blurb: string;
}

export const MODIFIERS: ModifierDef[] = [
  {
    key: "overtime",
    name: "Over Time",
    icon: "⏱️",
    tagline: "Bonus minute for a hot coin",
    blurb:
      "Near the end, if the coin is still cooking (trade volume, liquidity, and market cap), it earns a bonus minute so a banger gets to run. A quiet, dying coin gets nothing. It can save a coin and turn it into a winner at the last moment.",
  },
];

// ---- Over Time tuning ----
/** Checked when the clock drops to this many seconds left. */
export const OVERTIME_TRIGGER_REMAINING_SEC = 30;
/** Minutes credited each time the checkpoint is met. */
export const OVERTIME_EXTENSION_SEC = 60;
/** Cap on total bonus minutes, so a coin can't run forever. */
export const OVERTIME_MAX_PERIODS = 3;
/** "Still hot": recent 30s volume at least this fraction of pool depth… */
export const OVERTIME_VOLUME_FRACTION = 0.15;
/** …with an absolute floor so tiny pools still need real volume (pETH). */
export const OVERTIME_MIN_VOLUME = 0.15;
/** Or "close to bonding": market cap at least this fraction of graduation. */
export const OVERTIME_MCAP_FRACTION = 0.5;

// ---- The Pit (PvE vs Swarm AI) ----
/**
 * The Pit's live-trading length presets. Kept as a list so future presets are
 * configuration, not code; the launchpad renders them generically.
 */
export interface PitDurationDef {
  key: PitDurationKey;
  name: string;
  icon: string;
  minutes: number;
  tagline: string;
}

export const PIT_DURATIONS: PitDurationDef[] = [
  { key: "blitz", name: "Blitz", icon: "⚡", minutes: 1, tagline: "1 min · fast and violent" },
  { key: "standard", name: "Standard", icon: "🔥", minutes: 5, tagline: "5 min · balanced pacing" },
  { key: "marathon", name: "Marathon", icon: "🧠", minutes: 10, tagline: "10 min · long-form cycles" },
];

export const PIT_DURATION_MAP: Record<PitDurationKey, PitDurationDef> = Object.fromEntries(
  PIT_DURATIONS.map((d) => [d.key, d]),
) as Record<PitDurationKey, PitDurationDef>;

export const DEFAULT_PIT_DURATION: PitDurationKey = "standard";

/** The Pit's AI opponent brand — the crowd trades and predicts against them. */
export const PIT_AI_NAME = "The Flame Goon Squad AI";
export const PIT_AI_SHORT = "The Goon Squad";
/** Display name of the trading game mode. */
export const PIT_TRADING_MODE_NAME = "Battle the Flame Goon Squad AI";

/**
 * Default Pit economy and Swarm knobs. Every value here is overridable from the
 * admin dashboard (OpsSettings.pit) so no gameplay number is hardcoded in the
 * engine. Fees are pETH; the Pit fee is basis points of each entry.
 */
export const PIT_DEFAULTS = {
  tradingFee: 0.25,
  pitFeeBps: 1000, // 10%
  feeSplit: { platform: 0.4, jackpot: 0.25, creator: 0.2, treasury: 0.15 } as PitFeeSplit,
  /** Simulated paper stack every trader is handed for the match (pETH). */
  startingStack: 1.0,
  /** Paid-entry lobby window before live trading (seconds). */
  lobbySeconds: 45,
  /** Most Pit matches live at once; extras queue. */
  maxConcurrent: 5,
  /** Sweep unclaimed prize-pool money into the weekly jackpot. */
  carryover: true,
  /** Swarm AI knobs, 0..1. Aggression scales trade size/cadence; difficulty
   *  biases the narrative toward tougher markets for traders. */
  aggression: 0.5,
  difficulty: 0.5,
  /** Which duration presets creators may launch. */
  durations: ["blitz", "standard", "marathon"] as PitDurationKey[],
  // ---- Prediction market (variable betting) ----
  /** Prediction wager bounds (pETH) and quick-bet chips. */
  minBet: 0.05,
  maxBet: 5,
  quickChips: [0.05, 0.1, 0.25, 0.5, 1] as number[],
  /** Net prediction pool split between the two winner groups (bps, sum 10000). */
  mainAllocationBps: 7500,
  houseAllocationBps: 2500,
  /** Double Down Bonus: correct Main + correct House Special. */
  doubleDownBonus: 0.2,
  doubleDownType: "flat" as PitBonusType,
  /** House Specials in rotation — one is featured per match at random. */
  houseSpecials: [
    "early_rug",
    "late_rug",
    "flash_rug",
    "whale_rug",
    "early_graduate",
    "photo_finish",
    "bull_timer",
    "dead_market",
  ] as HouseSpecialKind[],
  // ---- Flame Trial (solo PvE) ----
  /** Base objective (bps) — the entry tier's bar and the fallback when a tier
   *  omits its own requirement. Higher tiers raise it (see trialTiers). */
  trialRequiredPnlBps: 2000,
  /** Entry stake bounds (USD equivalent). */
  trialMinUsd: 5,
  trialMaxUsd: 500,
  /** Quick countdown (seconds) from the creator's stake to live in a solo trial. */
  trialLobbySeconds: 15,
  /** Reward tiers by entry stake (USD). Higher stake = a higher PnL bar to pass,
   *  and in return more XP and rarer cosmetics. */
  trialTiers: [
    { name: "Recruit", minUsd: 5, requiredPnlBps: 2000, xp: 60, rarity: "common" },
    { name: "Henchman", minUsd: 10, requiredPnlBps: 3000, xp: 120, rarity: "common" },
    { name: "Elite", minUsd: 25, requiredPnlBps: 4500, xp: 250, rarity: "rare" },
    { name: "Legend", minUsd: 50, requiredPnlBps: 6000, xp: 500, rarity: "epic" },
    { name: "Mythic", minUsd: 100, requiredPnlBps: 10000, xp: 1000, rarity: "legendary" },
  ] as TrialTier[],
};

/** The tier a Flame Trial stake (in USD) qualifies for (highest met). */
export function trialTierFor(usd: number, tiers: TrialTier[]): TrialTier {
  let best = tiers[0]!;
  for (const t of tiers) if (usd + 1e-9 >= t.minUsd && t.minUsd >= best.minUsd) best = t;
  return best;
}

/** The House Special catalog — a rotating featured side bet per Pit match. */
export const HOUSE_SPECIALS: HouseSpecialDef[] = [
  { kind: "early_rug", name: "Early Rug", blurb: "Rugs in the first third" },
  { kind: "late_rug", name: "Late Rug", blurb: "Rugs in the final third" },
  { kind: "flash_rug", name: "Flash Rug", blurb: "Rugs in the first 15 seconds" },
  { kind: "whale_rug", name: "Whale Rug", blurb: "Pumps hard, then rugs" },
  { kind: "early_graduate", name: "Early Graduate", blurb: "Graduates in the first half" },
  { kind: "photo_finish", name: "Photo Finish", blurb: "Graduates at the buzzer, or just misses" },
  { kind: "bull_timer", name: "Bull Timer", blurb: "Times out with the market up" },
  { kind: "dead_market", name: "Dead Market", blurb: "Times out flat or down" },
];

export const HOUSE_SPECIAL_MAP: Record<HouseSpecialKind, HouseSpecialDef> = Object.fromEntries(
  HOUSE_SPECIALS.map((h) => [h.kind, h]),
) as Record<HouseSpecialKind, HouseSpecialDef>;

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
    // Rookie keeps its training wheels on after the open: live trading is
    // capped at the same 0.3 pETH so a beginner can't dump their whole bag.
    liveMaxPositionEth: 0.3,
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
    liveMaxPositionEth: 0, // the main arena: live trading is uncapped
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
    liveMaxPositionEth: 0, // degen: no caps anywhere, by design
    devSellLockSeconds: 0,
  },
};

/** Market-cap milestones announced in the kill feed (paper ETH ≈ $10k/$19k/$29k/$40k/$58k). */
export const MCAP_MILESTONES = [5, 10, 15, 21, 30];

/** Creator revenue share of round trading fees (capped — spec §5.3). */
export const CREATOR_FEE_SHARE = 0.3;

/** Referral revenue share — single tier only, no downlines (spec §11/§12). */
export const REFERRAL_FEE_SHARE = 0.1;

/**
 * Weekly Jackpot (volume-driven XP reward pool).
 *
 * A fixed slice of every round's trading fees accrues to a site-wide pot that
 * pays out weekly to the top players by XP earned that week. The share below
 * is 50% of the house cut: after the creator (30%) and referral (10%) shares,
 * the house keeps ~60% of fees; half of that — 30% of total fees — feeds the
 * jackpot. Kept as a share of total fees so accrual is one simple multiply.
 */
export const JACKPOT_FEE_SHARE = 0.3;
/** For display: the jackpot's cut expressed as a fraction of the house take. */
export const JACKPOT_HOUSE_SHARE = 0.5;
/** Number of weekly winners. */
export const JACKPOT_WINNERS = 10;
/**
 * Payout weights for ranks 1..10 (sum = 1). Top three are strictly the
 * largest; 4th–10th taper down. Rendered verbatim on the jackpot page.
 */
export const JACKPOT_PAYOUT_WEIGHTS = [
  0.25, 0.18, 0.14, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03,
] as const;

/** Community voting lifecycle: a submission is auto-shortlisted at the vote
 *  threshold; if the window closes below it, the submission is rejected. */
export const VOTE_THRESHOLD = 10;
export const VOTING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Creator-chosen token supply bounds (paper units). */
export const MIN_TOKEN_SUPPLY = 100_000;
export const MAX_TOKEN_SUPPLY = 1_000_000_000;
