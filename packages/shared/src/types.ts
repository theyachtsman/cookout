/** Shared domain types for The Cookout (Phase 1: paper money). */

export type Address = string;

export type RiskTier = "rookie" | "standard" | "degen";

/**
 * Curated launch modes (the launchpad's single choice). Each mode bundles a
 * live-trading length and whether rug mechanics apply, over a base economics
 * tier — see GAME_MODES. "endurance" is listed but not yet launchable.
 */
export type GameMode = "classic" | "pressure" | "blitz" | "reflex" | "endurance";

/** Round lifecycle. Linear except ENDED can be reached from any live-ish state. */
export type RoundState =
  | "scheduled" // on the match calendar, teaser visible
  | "lobby" // pre-round lobby open, countdown running
  | "queue_open" // batch auction intents accepted
  | "settling" // queue closed, computing clearing price
  | "live" // continuous trading
  | "ended" // end trigger fired, resolving
  | "cancelled" // Pit: queue expired without quorum, deposits refunded
  | "results"; // results published, archived

export type RoundEndReason =
  | "timer"
  | "rug_detected"
  | "liquidity_removed"
  | "mcap_target"
  | "low_volume"
  /** All bonding criteria met mid-round — rendered as "Served Up". */
  | "graduated"
  | "admin";

export interface PoolState {
  /** Paper-ETH reserve of the simulated AMM pool. */
  ethReserve: number;
  /** Token reserve. */
  tokenReserve: number;
  /** Fixed total supply of the round token. */
  totalSupply: number;
}

/** Creator-supplied social links for a coin, shown as interactive badges on the
 *  trading banner. All optional — only the ones set render. Stored as the raw
 *  handle or URL the creator entered; the client normalizes to a full link. */
export interface CoinSocials {
  x?: string;
  telegram?: string;
  youtube?: string;
  instagram?: string;
  website?: string;
}

/** Optional creator-chosen tweaks layered on top of a game mode. */
export interface CoinModifiers {
  /** Over Time: near the end, a coin that's still cooking (volume / liquidity /
   *  market cap) earns a bonus minute so a banger gets to run. */
  overtime?: boolean;
}

/**
 * Which game mode a match belongs to. Standard Cookout is the PvP experience;
 * The Pit is the PvE mode where players compete against Swarm AI. Absent means
 * "cookout" for every legacy match, so shared systems that don't branch on it
 * keep working unchanged.
 */
export type MatchType = "cookout" | "pit";

/** The Pit's live-trading length presets. See PIT_DURATIONS for the table. */
export type PitDurationKey = "blitz" | "standard" | "marathon";

/** A Pit main prediction call: the coin graduates, the Goon Squad rugs the
 *  market, or it runs the clock out (Timer). */
export type PitCall = "graduate" | "rug" | "timer";

/** The featured "House Special" side bet — one rotating condition per match. */
export type HouseSpecialKind =
  | "early_rug"
  | "late_rug"
  | "flash_rug"
  | "whale_rug"
  | "early_graduate"
  | "photo_finish"
  | "bull_timer"
  | "dead_market";
export interface HouseSpecialDef {
  kind: HouseSpecialKind;
  name: string;
  blurb: string;
}

/** Double Down Bonus reward type. Only "flat" (Cook Out balance) for now; the
 *  shape leaves room for percentage / XP / seasonal without a rewrite. */
export type PitBonusType = "flat";

/** A Flame Trial stake tier — an entry-cost band (USD) that scales rewards.
 *  The stake is a challenge cost, never a payout: a higher tier means more XP
 *  and higher-rarity cosmetic eligibility, not money back. */
export interface TrialTier {
  name: string;
  minUsd: number;
  /** Final-PnL objective to pass at this tier (bps). Higher stake = higher bar. */
  requiredPnlBps: number;
  xp: number;
  rarity: "common" | "rare" | "epic" | "legendary";
}

/** One of the Pit's prize pools, live state. */
export interface PitPoolState {
  /** Pot funded by this match's wagers (pETH). Held gross until settlement. */
  pot: number;
  /** Players entered in this pool. */
  participants: number;
  /** Pot carried in from prior matches (unused — pools feed the jackpot). */
  carryIn: number;
}

/** How the Pit fee is routed (fractions that sum to 1). */
export interface PitFeeSplit {
  platform: number;
  jackpot: number;
  creator: number;
  treasury: number;
}

/** Pit-specific config carried on a Pit round (round.pit). Every value is
 *  resolved from admin settings at launch so nothing is hardcoded downstream. */
export interface PitConfig {
  duration: PitDurationKey;
  /** Which game modes this match runs — chosen at launch. At least one is true. */
  predictionMode: boolean;
  tradingMode: boolean;
  /** Flame Trial: solo PvE objective mode (single-player, min 1 to start). */
  trialMode: boolean;
  trialParticipants: number;
  /** Trial objective: required final PnL in basis points (2000 = +20%). */
  trialRequiredPnlBps: number;
  /** Trial entry stake bounds (USD equivalent) + reward tiers, snapshot at launch. */
  trialMinUsd: number;
  trialMaxUsd: number;
  trialTiers: TrialTier[];
  /** Quick countdown (seconds) from the creator's stake to live in a solo trial. */
  trialLobbySeconds: number;
  /** Deposit window (seconds) a queued match waits for quorum before it cancels. */
  queueMaxSeconds: number;
  /** Prediction betting bounds + quick chips (pETH), snapshot at launch. */
  minBet: number;
  maxBet: number;
  quickChips: number[];
  /** How the net prediction pool splits between the two winner groups (bps). */
  mainAllocationBps: number;
  houseAllocationBps: number;
  /** Double Down Bonus (correct Main + correct House Special) + its type. */
  doubleDownBonus: number;
  doubleDownType: PitBonusType;
  /** The featured House Special for this match (present when predictionMode). */
  houseSpecial?: HouseSpecialDef;
  /** Trading buy-in default (pETH). */
  tradingFee: number;
  /** Pit fee in basis points, skimmed off the pools at settlement. */
  pitFeeBps: number;
  feeSplit: PitFeeSplit;
  /** Simulated paper stack (pETH) every trader is handed for the match. */
  startingStack: number;
  /** Prediction pool — pot is all prediction money (main + House Special),
   *  held gross through the lobby; participants = players with any wager. */
  prediction: PitPoolState;
  /** How many entered the Main prediction / the House Special. */
  mainParticipants: number;
  houseParticipants: number;
  trading: PitPoolState;
}

/** A player's Pit lobby entry. Editable/withdrawable until the round goes live. */
export interface PitEntry {
  /** Main prediction call. */
  prediction?: PitCall;
  /** Main prediction wager (pETH). */
  predictionStake?: number;
  /** Entered the featured House Special side bet. */
  houseSpecial?: boolean;
  /** House Special wager (pETH). */
  houseSpecialStake?: number;
  /** Whether they bought into the Trading Pool. */
  trading?: boolean;
  /** Custom trading buy-in (pETH). Everyone trades the same paper stack; the
   *  highest PnL wins the pool. */
  tradingStake?: number;
  /** Whether they entered the solo Flame Trial. */
  trial?: boolean;
  /** Flame Trial entry stake (pETH) — a challenge cost that sets the reward tier. */
  trialStake?: number;
}

/** One participant's Pit outcome, for the results modal and profile. */
export interface PitPlayerResult {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  /** Main prediction. */
  prediction?: PitCall;
  predictionCorrect?: boolean;
  predictionReward: number;
  /** House Special side bet. */
  houseSpecial?: boolean;
  houseSpecialCorrect?: boolean;
  houseSpecialReward: number;
  /** Double Down Bonus paid (correct Main + correct House Special). */
  doubleDownBonus: number;
  /** Trading. */
  tradingPnl?: number;
  qualified?: boolean;
  trades?: number;
  tradingReward: number;
  /** Flame Trial (solo objective). */
  trial?: boolean;
  trialStake?: number;
  trialPnlPct?: number;
  trialTier?: string;
  /** The tier's PnL bar the player had to clear (bps). */
  trialRequiredBps?: number;
  trialPassed?: boolean;
  trialXp?: number;
  totalReward: number;
  /** Total reward minus the actual bets paid this match. */
  net: number;
  /** Won the prediction market and the trading pool. */
  doubleWinner: boolean;
}

/** The Pit's per-match result, attached to a round summary. */
export interface PitResult {
  duration: PitDurationKey;
  outcome: PitCall;
  /** The featured House Special and whether it hit. */
  houseSpecial?: { def: HouseSpecialDef; hit: boolean };
  /** Main prediction bucket. */
  prediction: { pot: number; winners: number; rewardEach: number; carried: boolean };
  /** House Special bucket. */
  house: { pot: number; winners: number; rewardEach: number; carried: boolean };
  /** Double Down Bonuses paid this match. */
  doubleDown: { bonus: number; count: number };
  /** Trading bucket. */
  trading: { pot: number; qualified: number; rewardEach: number; carried: boolean };
  /** Flame Trial summary. */
  trial: { participants: number; passed: number; requiredPnlBps: number };
  /** Per-player breakdown (humans only), highest total reward first. */
  players: PitPlayerResult[];
}

/** Lifetime Pit record, shown on the profile's The Pit tab. */
export interface PitStats {
  matchesPlayed: number;
  /** Matches where the player placed any prediction (main or House Special). */
  predictionMarketsPlayed: number;
  predictionsMade: number;
  predictionsCorrect: number;
  /** Main prediction wins (paid out). */
  predictionWins: number;
  /** Lifetime main prediction wagered + won (pETH). */
  predictionStaked: number;
  predictionEarnings: number;
  /** House Special side bet. */
  houseEntered: number;
  houseWins: number;
  houseStaked: number;
  houseEarnings: number;
  /** Double Down Bonus. */
  doubleDowns: number;
  largestDoubleDown: number;
  /** Trading. */
  tradingEntries: number;
  tradingWins: number;
  tradingStaked: number;
  /** Flame Trial (solo objective mode). */
  trialsPlayed: number;
  trialsWon: number;
  trialXp: number;
  highestTrialPnlPct: number;
  highestTrialTier: string;
  trialWinStreak: number;
  bestTrialWinStreak: number;
  doubleWins: number;
  highestPnl: number;
  totalPnl: number;
  longestProfitStreak: number;
  currentProfitStreak: number;
  largestWin: number;
  totalEarnings: number;
  carryoverWins: number;
  byDuration: Record<PitDurationKey, { played: number; wins: number }>;
}

export interface TokenConcept {
  id: string;
  creatorAddress: Address;
  name: string;
  symbol: string;
  theme: string;
  pitch?: string;
  /** Mode modifiers (e.g. Over Time) chosen at launch. */
  modifiers?: CoinModifiers;
  /** The coin's socials (X / Telegram / YouTube / Instagram / website). */
  socials?: CoinSocials;
  artworkUrl?: string;
  /** Creator-chosen total supply (tokenomics); tier default when unset. */
  totalSupply?: number;
  /** Wide promo banner (data URL), shown behind the trading header. */
  bannerUrl?: string;
  /** Creator-chosen risk tier (level-gated); legacy concepts default rookie.
   *  When `mode` is set it derives the tier — this stays populated for display
   *  and the economics engine. */
  tier?: RiskTier;
  /** Game type: Standard Cookout (PvP) or The Pit (PvE vs Swarm AI). Absent =
   *  cookout. Pit concepts skip the vote and launch straight into the queue. */
  matchType?: MatchType;
  /** The Pit's chosen live-trading length preset (Blitz/Standard/Marathon). */
  pitDuration?: PitDurationKey;
  /** Which Pit game modes this launch runs (prediction / trading / Flame Trial). */
  pitModes?: { prediction: boolean; trading: boolean; trial?: boolean };
  /** Curated launch mode (Classic/Pressure/Blitz/Reflex). Drives tier, match
   *  length, and rug rules. Absent on legacy concepts. */
  mode?: GameMode;
  /** Creator-chosen live-trading length in minutes; the tier's default duration
   *  when unset. Derived from `mode` when a mode is chosen. */
  matchMinutes?: number;
  status: "submitted" | "shortlisted" | "scheduled" | "launched" | "rejected";
  votes: number;
  createdAt: number;
}

export interface RoundConfig {
  tier: RiskTier;
  /** Seconds the lobby is open before the queue opens. */
  lobbySeconds: number;
  /** Seconds the intent queue stays open. */
  queueSeconds: number;
  /** Max round duration in seconds once live. */
  maxDurationSeconds: number;
  /** Cap on total paper-ETH the batch auction will accept. */
  auctionMaxRaise: number;
  /** Initial pool liquidity (paper ETH). */
  initialEthLiquidity: number;
  initialTokenLiquidity: number;
  totalSupply: number;
  /** Trading fee in basis points, applied on continuous trades. */
  tradeFeeBps: number;
  /** Settlement fee in basis points, applied on auction fills. */
  auctionFeeBps: number;
  /** Round ends when market cap exceeds this (0 = disabled). */
  mcapTarget: number;
  /** Graduation threshold: market cap at round end. */
  graduationMcap: number;
  graduationMinHolders: number;
  graduationMinVolume: number;
  /** Round ends if volume stays below this for lowVolumeWindow seconds. */
  lowVolumeThreshold: number;
  lowVolumeWindowSeconds: number;
  /** Max position per player in the fair-open queue, in paper ETH (0 = uncapped). */
  maxPositionEth: number;
  /** Max ETH a player can have deployed during LIVE trading (0 = uncapped).
   *  A training-wheels ceiling on beginner tiers so nobody dumps their whole
   *  bag in one match; higher tiers leave live trading uncapped. */
  liveMaxPositionEth: number;
  /** Creator cannot sell for this many seconds after open (0 = no lock). */
  devSellLockSeconds: number;
  /** Whether rug mechanics apply: the dev-dump auto-rug, the pool-drain rug
   *  detector, and the dev sell lock. Off for Blitz/Reflex, where price action
   *  is the whole game and nobody can be "rugged". Undefined = on (default). */
  rugRules?: boolean;
  /** Over Time modifier active: near the end a still-hot coin earns +1 minute. */
  overtime?: boolean;
}

/** Deployed contract set backing an on-chain (Phase 2) round. When present,
 *  the chain is the source of truth: the server mirrors events and never
 *  moves player money — trades happen from players' own wallets. */
export interface ChainRoundInfo {
  chainId: number;
  token: string;
  pool: string;
  auction: string;
  createTx: string;
  /** Mirror cursor: last chain block already reflected into server state. */
  lastBlock: number;
}

export interface Round {
  id: string;
  conceptId: string;
  token: {
    name: string;
    symbol: string;
    theme: string;
    artworkUrl?: string;
    bannerUrl?: string;
    socials?: CoinSocials;
  };
  creatorAddress: Address;
  tier: RiskTier;
  /** Game type: Standard Cookout (PvP) or The Pit (PvE). Absent = cookout, so
   *  every legacy round and system that ignores it behaves exactly as before. */
  matchType?: MatchType;
  /** Present only on Pit rounds: durations, fees, pool state, paper stack. */
  pit?: PitConfig;
  /** The curated launch mode this round runs (Classic/Pressure/Blitz/Reflex). */
  mode?: GameMode;
  /** Mode modifiers chosen at launch (e.g. Over Time), for display + rules. */
  modifiers?: CoinModifiers;
  /** How many Over Time minutes have been credited this round. */
  overtimeCount?: number;
  state: RoundState;
  config: RoundConfig;
  /** Creator-chosen live-trading length in minutes. */
  matchMinutes?: number;
  /** 1-minute "Blitz" mode: rug-and-dodge rules. The creator can sell any
   *  time (no dev-sell lock) and dumping their whole bag rugs the coin with
   *  NO reputation hit or launch ban — the rug is the game. */
  blitz?: boolean;
  /** Epoch ms for the scheduled open (lobby start). */
  scheduledAt: number;
  queueOpensAt?: number;
  queueClosesAt?: number;
  liveAt?: number;
  endsAt?: number;
  endedAt?: number;
  endReason?: RoundEndReason;
  clearingPrice?: number;
  graduated?: boolean;
  pool?: PoolState;
  /** Present only for on-chain rounds. */
  chain?: ChainRoundInfo;
}

export interface AuctionIntent {
  id: string;
  roundId: string;
  userAddress: Address;
  ethAmount: number;
  /** Optional limit: max uniform clearing price the player accepts. */
  maxPrice?: number;
  submittedAt: number;
}

export interface AuctionFill {
  intentId: string;
  userAddress: Address;
  ethIn: number;
  ethFilled: number;
  tokensOut: number;
  refund: number;
}

export interface AuctionResult {
  roundId: string;
  clearingPrice: number;
  totalDemand: number;
  totalRaised: number;
  fillRatio: number;
  fills: AuctionFill[];
  poolAfter: PoolState;
  settledAt: number;
  /** Deterministic hash of inputs+outputs so the settlement is auditable. */
  auditHash: string;
}

/** A player's own Fair Open result, surfaced on the round page right after
 *  settlement so a partial fill is obvious in the moment (not just later in the
 *  wallet ledger). The auction is capped, so an oversubscribed pull-up fills
 *  pro-rata and refunds the rest. */
export interface MyFill {
  /** What they pulled up with (pETH). */
  committedEth: number;
  /** What actually cleared into their open position. */
  filledEth: number;
  /** The unfilled portion, refunded to their Cook Out balance. */
  refundEth: number;
  /** filledEth / committedEth, 0..1. */
  ratio: number;
  tokens: number;
}

export interface Trade {
  id: string;
  roundId: string;
  userAddress: Address;
  side: "buy" | "sell";
  ethAmount: number;
  tokenAmount: number;
  price: number;
  fee: number;
  at: number;
  /** True when the trader is the round's creator (rendered as "Developer"). */
  isCreator: boolean;
  /** Trader identity resolved at trade time, for the order book. */
  displayName?: string;
  avatarUrl?: string;
}

/** A trade joined with its round's coin identity, for the wallet's account-wide
 *  trade log. Carries every field the history table shows. */
export interface AccountTrade {
  id: string;
  roundId: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  /** ETH into the pool (buy) or out of it (sell). */
  ethAmount: number;
  tokenAmount: number;
  price: number;
  fee: number;
  at: number;
}

export interface Candle {
  /** Epoch seconds, 1-second buckets. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Position {
  userAddress: Address;
  roundId: string;
  tokens: number;
  costBasisEth: number;
  realizedPnl: number;
  firstBuyAt?: number;
  lastExitAt?: number;
}

export type KillFeedKind =
  | "big_buy"
  | "big_sell"
  | "whale_entered"
  | "dev_buy"
  | "dev_sell"
  | "rug_detected"
  | "mcap_milestone"
  | "new_leader"
  | "graduated"
  | "overtime";

export interface KillFeedEvent {
  id: string;
  roundId: string;
  kind: KillFeedKind;
  text: string;
  at: number;
  meta?: Record<string, string | number>;
}

export interface ChatMessage {
  id: string;
  /** Room the message belongs to: GLOBAL_ROOM or a round id. */
  roundId: string;
  userAddress: Address;
  displayName?: string;
  text: string;
  at: number;
  /** Equipped cosmetics resolved at send time (emoji badge, hex color). */
  badge?: string;
  color?: string;
  /** Level at send time — drives the rank chip beside the name. */
  level?: number;
  /** Sender had an active rug ban at send time — renders a 🚫 badge. */
  banned?: boolean;
  /** Match system events (queue opened, bond complete, rug…) render as
   *  inline banners rather than player messages. */
  system?: boolean;
  systemKind?: SystemChatKind;
}

export type SystemChatKind =
  | "queue_open"
  | "queue_closed"
  | "settled"
  | "live"
  | "leader"
  | "bond"
  | "whale"
  | "rug"
  | "graduated"
  | "ended"
  /** Admin/house announcement or rotating tip — high-attention styling. */
  | "announce"
  /** The Pit — Swarm AI system messages, styled with the Swarm accent:
   *  pit_open (created / lobby / pools open), pit_live (trading started),
   *  pit_event (whale / accumulate / panic / final ten), pit_result
   *  (complete / outcome / double winner / carryover). */
  | "pit_open"
  | "pit_live"
  | "pit_event"
  | "pit_result";

/** The always-on community room every connected player sits in. */
export const GLOBAL_ROOM = "global";

/** The Vote page's own channel — launchpad talk stays out of The Grill. */
export const VOTE_ROOM = "vote";

/** The Pit's own channel — Pit chatter + launch/live/results announcements.
 *  Each individual Pit match still has its own room (the round id). */
export const PIT_ROOM = "pit";

/** Where a player is right now — drives presence dots across the site. */
export type PresenceStatus =
  | "hanging"
  | "queue"
  | "trading"
  | "spectating"
  | "finished";

export interface PresenceUser {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  level: number;
  title: string;
  badge?: string;
  status: PresenceStatus;
  /** Round they're currently in, when the status is match-scoped. */
  roundId?: string;
  roundSymbol?: string;
}

/** Things worth telling the crowd about — the live activity feed. */
export type ActivityKind =
  | "joined"
  | "pulled_up"
  | "won"
  | "rekt"
  | "graduated"
  | "level_up"
  | "achievement"
  | "jackpot"
  | "submitted";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  /** Pre-rendered line, e.g. "reached Level 15". */
  text: string;
  at: number;
  roundId?: string;
  roundSymbol?: string;
}

export interface Prediction {
  roundId: string;
  userAddress: Address;
  call: "moon" | "rug";
  at: number;
}

/** A player's linked Telegram account (companion notifications via The Pit Boss). */
export interface TelegramLink {
  /** Telegram user id (numeric, stored as string). */
  userId: string;
  /** @handle, when the user has one set. */
  username?: string;
  /** The private chat id the bot DMs — usually equal to userId. */
  chatId: string;
  linkedAt: number;
}

/** The granular notification switches a linked player controls. */
export type NotifyCategory =
  | "levelUps"
  | "titles"
  | "achievements"
  | "quests"
  | "streaks"
  | "leaderboard"
  | "jackpot"
  | "votingMilestones"
  | "fairOpen"
  | "trading"
  | "graduations"
  | "rugs"
  | "reputation"
  | "launchBans"
  | "runItBack"
  | "patchNotes"
  | "announcements"
  | "followedPlayers";

export type NotificationPrefs = Record<NotifyCategory, boolean>;

export interface UserProfile {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  /** Wide header banner shown behind the avatar + level on profiles. */
  bannerUrl?: string;
  /** Flame Goon Squad system account? Drives the AI badge on their profile. */
  isAI?: boolean;
  /** Short bio (used by Goon Squad profiles). */
  bio?: string;
  /** Goon Squad handle (/profile/<handle>), for system AI accounts. */
  goonHandle?: string;
  /** Linked Telegram companion account, if any. */
  telegram?: TelegramLink;
  /** Per-category Telegram notification switches (defaults applied when unset). */
  notifyPrefs?: Partial<NotificationPrefs>;
  /** Permanent Founding Member number (assigned once, never reused). */
  founderNumber?: number;
  /** When they claimed founder status. */
  founderSince?: number;
  xp: number;
  level: number;
  title: string;
  /** The bank: everything not staked into the arena. */
  paperBalance: number;
  /** The hot balance matches actually spend. You deposit into it, the same
   *  way the on-chain arena wallet works, so the habit carries to mainnet. */
  arenaBalance?: number;
  achievements: string[];
  referralCode: string;
  referredBy?: Address;
  createdAt: number;
  creatorReputation: number;
  /** Rug-ban record, oldest first. The LAST entry is the live one; earlier
   *  entries are history and stay on the profile even after being lifted. */
  rugBans?: RugBan[];
  /** Computed at serialization time: does this wallet have an active ban? */
  banned?: boolean;
  stats: UserStats;
  /** Lifetime jackpot winnings (paper ETH in Phase 1). */
  jackpotWinnings?: number;
  /** Individual weekly jackpot wins, newest last (shown on profiles). */
  jackpotWins?: JackpotWin[];
  /** Lifetime record in The Pit (PvE vs Swarm AI). Absent until first entry. */
  pitStats?: PitStats;
}

/**
 * One launch ban earned by rugging a coin. Two flavors, set by live-ops:
 *  - self-serve (paper beta): no expiry — the player clears it from their own
 *    profile (or an admin does), and the record stays visible;
 *  - wait-out (real-money): `expiresAt` is set from the admin-configurable
 *    escalation schedule — repeat offenses wait longer — and only time or an
 *    admin lifts it.
 */
export interface RugBan {
  at: number;
  /** The round that was rugged. */
  roundId?: string;
  symbol?: string;
  tier?: RiskTier;
  /** 1st, 2nd, 3rd rug… drives the escalation schedule. */
  offense: number;
  /** Wait-out mode: when the ban lifts itself. Absent = until lifted. */
  expiresAt?: number;
  liftedAt?: number;
  liftedBy?: "self" | "admin" | "timeout";
}

/** A single weekly jackpot win, recorded on the winner's profile. */
export interface JackpotWin {
  week: string; // ISO week key, e.g. "2026-W29"
  rank: number; // 1..10
  amountEth: number;
  amountUsd: number;
  at: number;
}

/** One winner row in a settled or projected weekly jackpot. */
export interface JackpotStanding {
  rank: number;
  address: Address;
  displayName?: string;
  level: number;
  title: string;
  badge?: string;
  weeklyXp: number;
  amountEth: number;
  amountUsd: number;
}

/** A settled weekly payout, archived in jackpot history. */
export interface JackpotPayout {
  week: string;
  paidAt: number;
  totalEth: number;
  totalUsd: number;
  ethUsd: number;
  winners: JackpotStanding[];
}

/** Live jackpot state served to the whole site (GET /api/jackpot). */
export interface JackpotStatus {
  week: string;
  poolEth: number;
  poolUsd: number;
  ethUsd: number;
  paperMode: boolean;
  /** Fee routing, percentages of every trade fee. */
  breakdown: { creatorPct: number; referralPct: number; jackpotPct: number; housePct: number };
  /** Site-wide trading volume this week (pETH) — what fed the fees. */
  weekVolumeEth: number;
  /** Site-wide trading fees collected this week (pETH). */
  weekFeesEth: number;
  payoutWeights: number[];
  nextPayoutAt: number;
  lifetimePaidEth: number;
  /** Projected top-10 for the in-progress week, by XP earned this week. */
  standings: JackpotStanding[];
  lastPayout: JackpotPayout | null;
  history: JackpotPayout[];
}

/** One row of a player's public trading history, written at round end. */
export interface RoundHistoryEntry {
  roundId: string;
  name: string;
  symbol: string;
  tier: RiskTier;
  pnl: number;
  invested: number;
  endReason: RoundEndReason;
  graduated: boolean;
  at: number;
}

export interface UserStats {
  roundsPlayed: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  bestTradePnl: number;
  rugsSurvived: number;
  predictionsCorrect: number;
  predictionsMade: number;
  currentWinStreak: number;
  bestWinStreak: number;
}

export interface RoundSummary {
  roundId: string;
  endReason: RoundEndReason;
  graduated: boolean;
  durationSeconds: number;
  totalVolume: number;
  peakMcap: number;
  finalMcap: number;
  holderCount: number;
  averageReturnPct: number;
  winner?: { address: Address; pnl: number };
  topProfit?: { address: Address; pnl: number };
  bestTrade?: { address: Address; pnl: number };
  biggestWhale?: { address: Address; ethIn: number };
  diamondHands?: { address: Address; holdSeconds: number };
  fastestExit?: { address: Address; seconds: number };
  /** Final standings by XP earned this round (highest first), capped to the top
   *  few. Powers the round-results scoreboard (e.g. the Telegram post). Carries
   *  PnL too, for anywhere that wants it. */
  leaderboard?: Array<{ address: Address; xp: number; pnl: number }>;
  /** Per-holder pro-rata exit when a round does NOT graduate: everyone still
   *  holding is redeemed at one uniform price. Real players only (bots omitted),
   *  highest payout first. Absent on graduated rounds (holders keep their bags). */
  redemption?: RedemptionEntry[];
  /** The uniform exit price (ETH per token) used for that redemption. */
  redemptionPrice?: number;
  /** Present only on Pit rounds: prediction/trading pool outcomes + payouts. */
  pit?: PitResult;
}

/** One player's slice of a non-graduated round's uniform pro-rata exit. */
export interface RedemptionEntry {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  /** Tokens the holder redeemed at resolution. */
  tokens: number;
  /** Pro-rata ETH paid out for those tokens. */
  eth: number;
  /** Realized PnL on the exit (payout − cost basis). */
  pnl: number;
}

/** A Cook Out balance movement, for the wallet's history ledger. */
export type LedgerKind =
  | "stake"
  | "unstake"
  | "pull_up"
  | "refund"
  | "redeem"
  | "creator_fee"
  | "jackpot"
  | "buy"
  | "sell"
  /** The Pit: prediction-pool entry fee (debit). */
  | "pit_prediction"
  /** The Pit: trading-pool entry fee (debit). */
  | "pit_trading"
  /** The Pit: prize-pool payout (credit). */
  | "pit_reward"
  /** The Pit: creator's share of Pit fees for their match (credit). */
  | "pit_creator"
  /** The Pit: Flame Trial entry stake (debit — a challenge cost, no prize pool). */
  | "pit_trial"
  /** Burger economy: Cook Out balance spent buying $BURG (debit). */
  | "burger_purchase";
/* ========================================================================== *
 *  Burger economy ($BURG) — a second progression currency (earned power).
 *  Fully data-driven: every reward amount, cooldown, and revenue split lives in
 *  admin settings (BurgerSettings), never hardcoded in gameplay code. Balances
 *  are permanent and stored independently from XP / Cook Out balance / jackpot.
 * ========================================================================== */

/** Where a Burger award came from. Placeholder sources (collection, pit,
 *  loot_box, season, marketplace, nft) have reward hooks now but no gameplay
 *  behind them yet — future systems call the same award service. */
export type BurgerSource =
  | "match_complete"
  | "xp_milestone"
  | "daily_quest"
  | "weekly_quest"
  | "coin_launch"
  | "coin_graduation"
  | "one_time"
  | "seasonal"
  | "collection"
  | "pit"
  | "loot_box"
  | "season_pass"
  | "referral"
  | "marketplace"
  | "nft"
  | "admin_grant"
  | "purchase"
  | "adjustment"
  | "refund";

/** The category a Burger transaction rolls up to (for the history filter). */
export type BurgerCategory =
  | "reward"
  | "purchase"
  | "adjustment"
  | "refund"
  | "admin_grant"
  | "spend";

/** One movement in a player's Burger balance, newest last. */
export interface BurgerTxn {
  id: string;
  at: number;
  source: BurgerSource;
  category: BurgerCategory;
  /** Signed $BURG change: positive credits, negative debits. */
  amount: number;
  /** $BURG balance immediately after this entry. */
  balanceAfter: number;
  /** Human label shown in the toast + history ("Match Complete"). */
  label: string;
  /** Optional reference id (roundId, milestone id, purchase id, …). */
  ref?: string;
}

/** A configurable reward rule — the backend is the sole authority on eligibility,
 *  amount, cooldown, repeatability, and seasonal availability. */
export interface BurgerRewardRule {
  source: BurgerSource;
  label: string;
  /** $BURG paid when the rule fires. */
  amount: number;
  enabled: boolean;
  /** False = claimable once per player (a one-time source). */
  repeatable: boolean;
  /** Minimum seconds between awards of this source per player (0 = none). */
  cooldownSec: number;
  /** If set, the rule only pays while now < seasonalUntil (epoch ms). */
  seasonalUntil?: number;
}

/** A Burger reward gated on reaching an XP level. */
export interface BurgerXpMilestone {
  level: number;
  amount: number;
  enabled: boolean;
}

/** A one-time Burger milestone (First Match, First Launch, …), per player. */
export interface BurgerOneTimeMilestone {
  id: string;
  label: string;
  amount: number;
  enabled: boolean;
}

/** Where Burger purchase revenue is routed (fractions that sum to ~1). */
export type BurgerRevenueDest = "jackpot" | "creator" | "referral" | "pit" | "house";

/** One line of the revenue ledger: a slice of a purchase routed to a dest. */
export interface BurgerRevenueEntry {
  id: string;
  at: number;
  /** The whole purchase (pETH spent) this slice came from. */
  purchaseEth: number;
  dest: BurgerRevenueDest;
  /** Fraction of the purchase this slice represents. */
  pct: number;
  /** pETH routed to the dest. */
  amount: number;
  /** Purchase id this slice belongs to. */
  ref: string;
}

/** The admin-tunable Burger economy (see BURGER_DEFAULTS). */
export interface BurgerSettings {
  enabled: boolean;
  /** $BURG minted per 1 pETH of Cook Out balance spent on a purchase. */
  burgersPerEth: number;
  /** Per-source reward rules, keyed by source. */
  rules: BurgerRewardRule[];
  /** XP-level reward ladder. */
  xpMilestones: BurgerXpMilestone[];
  /** One-time milestone rewards. */
  oneTimeMilestones: BurgerOneTimeMilestone[];
  /** Purchase revenue split by destination (fractions, normalized on use). */
  revenueAllocation: Record<BurgerRevenueDest, number>;
}

/** Aggregate economy-health analytics for the admin dashboard. */
export interface BurgerAnalytics {
  totalEarned: number;
  totalPurchased: number;
  totalSpent: number;
  circulating: number;
  holders: number;
  avgPerPlayer: number;
  avgEarnedPerDay: number;
  /** Earned $BURG by source, biggest first. */
  bySource: { source: BurgerSource; label: string; amount: number }[];
  /** Earned $BURG per UTC day (dayKey → amount), recent first. */
  daily: { day: string; amount: number }[];
  /** Top earners by lifetime earned $BURG. */
  topEarners: { address: string; displayName?: string; earned: number }[];
  /** Purchased ÷ earned — a rough inflation gauge (sink readiness). */
  sinkRatio: number;
  revenueEth: number;
}

/** A Cook Out balance movement, for the wallet's history ledger. */
export interface LedgerEntry {
  id: string;
  at: number;
  kind: LedgerKind;
  /** Signed change to the Cook Out balance (pETH): positive credits, negative debits. */
  amount: number;
  /** Cook Out balance immediately after this entry. */
  balanceAfter: number;
  /** Coin symbol for round-scoped entries (pull_up, refund, redeem, creator_fee). */
  symbol?: string;
  /** Round id for the entry, so the ledger ticker links to that match's results. */
  roundId?: string;
}

/** WebSocket messages: server → client. */
export type ServerEvent =
  | { type: "round_state"; round: Round }
  | {
      type: "lobby_update";
      roundId: string;
      players: number;
      spectators: number;
      committedEth: number;
      avgEntry: number;
      queueDepth: number;
      /** Server wall-clock at emit — lets the client sync its countdowns. */
      serverNow: number;
    }
  | { type: "auction_settled"; result: AuctionResult }
  | { type: "trade"; trade: Trade }
  | { type: "candle"; roundId: string; candle: Candle }
  | { type: "presence"; online: PresenceUser[] }
  | { type: "activity"; event: ActivityEvent }
  | {
      type: "ticker";
      roundId: string;
      price: number;
      mcap: number;
      /** Running all-time-high market cap for the round. */
      athMcap?: number;
      liquidity: number;
      volume: number;
      holders: number;
      ageSeconds: number;
      /** Flavor flag: round is running hot (high recent volume). Shown
       *  alongside real numbers, never replacing them (spec §1 "Cooking"). */
      cooking: boolean;
      /** Live ETH/USD used to render USD figures (bond is $-pegged). */
      ethUsd: number;
      /** Server wall-clock at emit — lets the client sync its countdowns. */
      serverNow: number;
    }
  | { type: "killfeed"; event: KillFeedEvent }
  | { type: "chat"; message: ChatMessage }
  | { type: "round_end"; roundId: string; summary: RoundSummary }
  | { type: "prediction_update"; roundId: string; moon: number; rug: number }
  | { type: "reaction"; roundId: string; emoji: string; from: string }
  | { type: "chat_delete"; roundId: string; messageId: string }
  /** A message was edited by moderation (censored) — replace it by id. */
  | { type: "chat_update"; message: ChatMessage }
  /** The Grill's pinned announcement changed ("" clears it). */
  | { type: "pinned"; text: string }
  /** Someone @-mentioned you in chat — sent only to the pinged user. */
  | { type: "ping"; ping: PingEntry }
  /** XP just landed — drives the +XP drop-in overlay. Sent only to that user. */
  | { type: "xp"; amount: number; total: number; level: number; source?: string }
  /** Burgers just landed — drives the 🍔 toast + balance count-up. Sent only to
   *  that user. `balance` is the running $BURG total after the award. */
  | { type: "burger"; amount: number; balance: number; source: BurgerSource; label: string }
  /** A cinematic Flame Goon Squad moment ("GHOST ENTERED THE PIT"), broadcast to
   *  a Pit room. Drives the overlay banners on the Pit pages. */
  | { type: "error"; message: string };

/** An @-mention of a player in chat, shown in their Pings feed. */
export interface PingEntry {
  id: string;
  /** Who sent the ping. */
  fromAddress: Address;
  fromName?: string;
  fromAvatarUrl?: string;
  /** Channel it was said in (GLOBAL_ROOM, VOTE_ROOM, or a round id). */
  roundId: string;
  /** The message text they were pinged in. */
  text: string;
  at: number;
}

/** WebSocket messages: client → server. */
export type ClientEvent =
  | { type: "subscribe"; roundId: string }
  | { type: "unsubscribe"; roundId: string }
  | { type: "chat"; roundId: string; text: string }
  /** Spectator cheer / emoji reaction — ephemeral, not stored. */
  | { type: "react"; roundId: string; emoji: string };
