/** Shared domain types for The Cookout (Phase 1: paper money). */

export type Address = string;

export type RiskTier = "rookie" | "standard" | "degen";

/** Round lifecycle. Linear except ENDED can be reached from any live-ish state. */
export type RoundState =
  | "scheduled" // on the match calendar, teaser visible
  | "lobby" // pre-round lobby open, countdown running
  | "queue_open" // batch auction intents accepted
  | "settling" // queue closed, computing clearing price
  | "live" // continuous trading
  | "ended" // end trigger fired, resolving
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

export interface TokenConcept {
  id: string;
  creatorAddress: Address;
  name: string;
  symbol: string;
  theme: string;
  pitch?: string;
  artworkUrl?: string;
  /** Creator-chosen total supply (tokenomics); tier default when unset. */
  totalSupply?: number;
  /** Wide promo banner (data URL), shown behind the trading header. */
  bannerUrl?: string;
  /** Creator-chosen risk tier (level-gated); legacy concepts default rookie. */
  tier?: RiskTier;
  /** Creator-chosen live-trading length in minutes (10, 5, or 1); the tier's
   *  default duration when unset. */
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
  token: { name: string; symbol: string; theme: string; artworkUrl?: string; bannerUrl?: string };
  creatorAddress: Address;
  tier: RiskTier;
  state: RoundState;
  config: RoundConfig;
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
  | "graduated";

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
  | "announce";

/** The always-on community room every connected player sits in. */
export const GLOBAL_ROOM = "global";

/** The Vote page's own channel — launchpad talk stays out of The Grill. */
export const VOTE_ROOM = "vote";

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

export interface UserProfile {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
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
  | { type: "error"; message: string };

/** WebSocket messages: client → server. */
export type ClientEvent =
  | { type: "subscribe"; roundId: string }
  | { type: "unsubscribe"; roundId: string }
  | { type: "chat"; roundId: string; text: string }
  /** Spectator cheer / emoji reaction — ephemeral, not stored. */
  | { type: "react"; roundId: string; emoji: string };
