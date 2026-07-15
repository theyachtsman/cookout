import {
  DEV_DUMP_FRACTION,
  MCAP_MILESTONES,
  RUG_DRAIN_FRACTION,
  RUG_WINDOW_SECONDS,
  TIER_CONFIGS,
  WHALE_TRADE_FRACTION,
  buy,
  marketCap,
  sell,
  settleAuction,
  spotPrice,
  type Address,
  type Candle,
  type KillFeedKind,
  type PoolState,
  type RiskTier,
  type Round,
  type RoundEndReason,
  type ServerEvent,
  type TokenConcept,
  type Trade,
} from "@cookout/shared";
import { evaluateRoundEnd } from "./gamification.js";
import type { Store } from "./store.js";

/** Per-player per-round telemetry used for achievements and the summary. */
export interface PlayerMeta {
  firstBuyAt?: number;
  fullExitAt?: number;
  maxTokens: number;
  ethInvested: number;
  biggestBuyEth: number;
  bestSellPnl: number;
  soldNearPeak: boolean;
  boughtNearBottom: boolean;
  whaleHunter: boolean;
  minPnlFrac: number; // worst unrealized drawdown vs cost basis
  tokensSoldBeforeEnd: number;
}

interface LiveRoundState {
  candle?: Candle;
  volumeBySecond: Map<number, number>;
  reserveBySecond: Map<number, number>;
  totalVolume: number;
  peakPrice: number;
  peakMcap: number;
  bottomPrice: number;
  bottomAt: number;
  milestonesHit: number[];
  leader?: Address;
  lastWhaleAt?: number;
  paused: boolean;
  pausedAt?: number;
  meta: Map<Address, PlayerMeta>;
}

export type Broadcast = (roundId: string, event: ServerEvent) => void;

export class RoundEngine {
  private live = new Map<string, LiveRoundState>();

  constructor(
    private store: Store,
    private broadcast: Broadcast,
    /** Supplies current spectator count for lobby updates. */
    private spectatorCount: (roundId: string) => number = () => 0,
  ) {}

  scheduleRound(concept: TokenConcept, tier: RiskTier, scheduledAt: number): Round {
    const config = { ...TIER_CONFIGS[tier] };
    const round: Round = {
      id: this.store.id(),
      conceptId: concept.id,
      token: {
        name: concept.name,
        symbol: concept.symbol,
        theme: concept.theme,
        artworkUrl: concept.artworkUrl,
      },
      creatorAddress: concept.creatorAddress,
      tier,
      state: "scheduled",
      config,
      scheduledAt,
    };
    concept.status = "scheduled";
    this.store.rounds.set(round.id, round);
    this.store.intents.set(round.id, []);
    return round;
  }

  private liveState(roundId: string): LiveRoundState {
    let s = this.live.get(roundId);
    if (!s) {
      s = {
        volumeBySecond: new Map(),
        reserveBySecond: new Map(),
        totalVolume: 0,
        peakPrice: 0,
        peakMcap: 0,
        bottomPrice: Infinity,
        bottomAt: 0,
        milestonesHit: [],
        paused: false,
        meta: new Map(),
      };
      this.live.set(roundId, s);
    }
    return s;
  }

  meta(roundId: string, address: Address): PlayerMeta {
    const s = this.liveState(roundId);
    let m = s.meta.get(address);
    if (!m) {
      m = {
        maxTokens: 0,
        ethInvested: 0,
        biggestBuyEth: 0,
        bestSellPnl: 0,
        soldNearPeak: false,
        boughtNearBottom: false,
        whaleHunter: false,
        minPnlFrac: 0,
        tokensSoldBeforeEnd: 0,
      };
      s.meta.set(address, m);
    }
    return m;
  }

  /** Advance every round's state machine. Call once per second. */
  tick(now: number): void {
    for (const round of this.store.rounds.values()) {
      switch (round.state) {
        case "scheduled":
          if (now >= round.scheduledAt) {
            round.state = "lobby";
            round.queueOpensAt = round.scheduledAt + round.config.lobbySeconds * 1000;
            this.emitState(round);
          }
          break;
        case "lobby":
          if (now >= round.queueOpensAt!) {
            round.state = "queue_open";
            round.queueClosesAt = round.queueOpensAt! + round.config.queueSeconds * 1000;
            this.emitState(round);
          }
          this.emitLobby(round);
          break;
        case "queue_open":
          if (now >= round.queueClosesAt!) {
            this.settle(round, now);
          } else {
            this.emitLobby(round);
          }
          break;
        case "live":
          this.tickLive(round, now);
          break;
        default:
          break;
      }
    }
  }

  submitIntent(
    roundId: string,
    address: Address,
    ethAmount: number,
    maxPrice: number | undefined,
    now: number,
  ) {
    const round = this.mustRound(roundId);
    if (round.state !== "queue_open") throw new Err(409, "queue is not open");
    if (!(ethAmount > 0)) throw new Err(400, "ethAmount must be positive");
    const cap = round.config.maxPositionEth;
    const user = this.store.getOrCreateUser(address);
    const existing = this.store.intents.get(roundId)!;
    const mine = existing.filter((i) => i.userAddress === user.address);
    const committed = mine.reduce((s, i) => s + i.ethAmount, 0);
    if (cap > 0 && committed + ethAmount > cap)
      throw new Err(400, `position cap is ${cap} paper ETH for this tier`);
    if (user.paperBalance < ethAmount) throw new Err(400, "insufficient paper balance");
    user.paperBalance -= ethAmount; // escrow until settlement
    if (mine.length === 0) this.store.trackActivity(user.address, "auctions_entered", 1, now);
    const intent = {
      id: this.store.id(),
      roundId,
      userAddress: user.address,
      ethAmount,
      maxPrice,
      submittedAt: now,
    };
    existing.push(intent);
    this.emitLobby(round);
    return intent;
  }

  cancelIntent(roundId: string, address: Address, intentId: string) {
    const round = this.mustRound(roundId);
    if (round.state !== "queue_open") throw new Err(409, "queue is not open");
    const intents = this.store.intents.get(roundId)!;
    const idx = intents.findIndex(
      (i) => i.id === intentId && i.userAddress === address.toLowerCase(),
    );
    if (idx === -1) throw new Err(404, "intent not found");
    const [intent] = intents.splice(idx, 1);
    this.store.getOrCreateUser(address).paperBalance += intent!.ethAmount;
    this.emitLobby(round);
  }

  /** Queue closed: settle every intent at one clearing price, atomically. */
  private settle(round: Round, now: number): void {
    round.state = "settling";
    this.emitState(round);
    const cfg = round.config;
    const pool: PoolState = {
      ethReserve: cfg.initialEthLiquidity,
      tokenReserve: cfg.initialTokenLiquidity,
      totalSupply: cfg.totalSupply,
    };
    const intents = this.store.intents.get(round.id)!;
    const result = settleAuction({
      roundId: round.id,
      intents,
      pool,
      maxRaise: cfg.auctionMaxRaise,
      feeBps: cfg.auctionFeeBps,
      now,
    });
    for (const fill of result.fills) {
      const user = this.store.getOrCreateUser(fill.userAddress);
      user.paperBalance += fill.refund; // unfilled escrow back
      if (fill.tokensOut > 0) {
        const pos = this.store.position(round.id, fill.userAddress);
        pos.tokens += fill.tokensOut;
        pos.costBasisEth += fill.ethFilled;
        pos.firstBuyAt = now;
        const m = this.meta(round.id, fill.userAddress);
        m.firstBuyAt = now;
        m.maxTokens = Math.max(m.maxTokens, pos.tokens);
        m.ethInvested += fill.ethFilled;
        m.biggestBuyEth = Math.max(m.biggestBuyEth, fill.ethFilled);
      }
    }
    const fee = result.totalRaised - (result.poolAfter.ethReserve - pool.ethReserve);
    this.store.feesByRound.set(round.id, (this.store.feesByRound.get(round.id) ?? 0) + fee);
    this.store.auctionResults.set(round.id, result);

    round.pool = result.poolAfter;
    round.clearingPrice = result.clearingPrice;
    round.state = "live";
    round.liveAt = now;
    round.endsAt = now + cfg.maxDurationSeconds * 1000;
    const s = this.liveState(round.id);
    s.peakPrice = result.clearingPrice;
    s.peakMcap = marketCap(round.pool);
    s.bottomPrice = result.clearingPrice;
    s.bottomAt = now;
    this.broadcast(round.id, { type: "auction_settled", result });
    this.emitState(round);
  }

  trade(
    roundId: string,
    address: Address,
    side: "buy" | "sell",
    amount: { eth?: number; tokens?: number; pct?: number },
    now: number,
  ): Trade {
    const round = this.mustRound(roundId);
    const s = this.liveState(roundId);
    if (round.state !== "live") throw new Err(409, "round is not live");
    if (s.paused) throw new Err(423, "round is paused");
    const user = this.store.getOrCreateUser(address);
    const pos = this.store.position(roundId, user.address);
    const m = this.meta(roundId, user.address);
    const pool = round.pool!;
    const preReserve = pool.ethReserve;
    let trade: Trade;

    if (side === "buy") {
      const ethIn = amount.eth ?? 0;
      if (!(ethIn > 0)) throw new Err(400, "eth amount required");
      if (user.paperBalance < ethIn) throw new Err(400, "insufficient paper balance");
      const cap = round.config.maxPositionEth;
      if (cap > 0 && pos.costBasisEth + ethIn > cap)
        throw new Err(400, `position cap is ${cap} paper ETH for this tier`);
      const r = buy(pool, ethIn, round.config.tradeFeeBps);
      user.paperBalance -= ethIn;
      round.pool = r.pool;
      pos.tokens += r.amountOut;
      pos.costBasisEth += ethIn;
      if (!pos.firstBuyAt) pos.firstBuyAt = now;
      if (!m.firstBuyAt) m.firstBuyAt = now;
      m.maxTokens = Math.max(m.maxTokens, pos.tokens);
      m.ethInvested += ethIn;
      m.biggestBuyEth = Math.max(m.biggestBuyEth, ethIn);
      if (r.price <= s.bottomPrice * 1.02 && now - s.bottomAt <= 5000) m.boughtNearBottom = true;
      this.store.feesByRound.set(roundId, (this.store.feesByRound.get(roundId) ?? 0) + r.fee);
      trade = this.recordTrade(round, user.address, "buy", ethIn, r.amountOut, r.price, r.fee, now);
      if (ethIn >= WHALE_TRADE_FRACTION * preReserve) {
        s.lastWhaleAt = now;
        this.kill(round, "whale_entered", `Whale entered with ${fmt(ethIn)} ETH`, now);
      }
      if (user.address === round.creatorAddress)
        this.kill(round, "dev_buy", `Developer bought ${fmt(ethIn)} ETH`, now);
    } else {
      let tokens = amount.tokens ?? (amount.pct ? pos.tokens * Math.min(1, amount.pct / 100) : 0);
      tokens = Math.min(tokens, pos.tokens);
      if (!(tokens > 0)) throw new Err(400, "nothing to sell");
      const r = sell(pool, tokens, round.config.tradeFeeBps);
      round.pool = r.pool;
      const costShare = pos.costBasisEth * (tokens / pos.tokens);
      const pnl = r.amountOut - costShare;
      pos.tokens -= tokens;
      pos.costBasisEth -= costShare;
      pos.realizedPnl += pnl;
      user.paperBalance += r.amountOut;
      m.bestSellPnl = Math.max(m.bestSellPnl, pnl);
      m.tokensSoldBeforeEnd += tokens;
      if (r.price >= s.peakPrice * 0.95) m.soldNearPeak = true;
      if (s.lastWhaleAt && now - s.lastWhaleAt <= 10_000 && pnl > 0) m.whaleHunter = true;
      if (pos.tokens <= 1e-9) {
        pos.tokens = 0;
        pos.lastExitAt = now;
        if (!m.fullExitAt) m.fullExitAt = now;
      }
      this.store.feesByRound.set(roundId, (this.store.feesByRound.get(roundId) ?? 0) + r.fee);
      trade = this.recordTrade(round, user.address, "sell", r.amountOut, tokens, r.price, r.fee, now);
      const pctMove = costShare > 0 ? Math.round((pnl / costShare) * 100) : 0;
      if (Math.abs(pnl) >= 0.05)
        this.kill(
          round,
          "big_sell",
          `${short(user.address)} sold ${pctMove >= 0 ? "+" : ""}${pctMove}%`,
          now,
        );
      if (user.address === round.creatorAddress) {
        this.kill(round, "dev_sell", `Developer sold ${fmt(r.amountOut)} ETH`, now);
        if (tokens >= DEV_DUMP_FRACTION * (tokens + pos.tokens))
          this.endRound(round, "rug_detected", now);
      }
    }

    user.stats.trades += 1;
    const season = (user.seasons[this.store.seasonKey(now)] ??= { pnl: 0, xp: 0, wins: 0, trades: 0 });
    season.trades += 1;
    this.store.trackActivity(user.address, "trades", 1, now);
    this.afterTrade(round, now);
    return trade;
  }

  private recordTrade(
    round: Round,
    address: Address,
    side: "buy" | "sell",
    ethAmount: number,
    tokenAmount: number,
    price: number,
    fee: number,
    now: number,
  ): Trade {
    const trade: Trade = {
      id: this.store.id(),
      roundId: round.id,
      userAddress: address,
      side,
      ethAmount,
      tokenAmount,
      price,
      fee,
      at: now,
      isCreator: address === round.creatorAddress,
    };
    let list = this.store.trades.get(round.id);
    if (!list) {
      list = [];
      this.store.trades.set(round.id, list);
    }
    list.push(trade);

    const s = this.liveState(round.id);
    const sec = Math.floor(now / 1000);
    s.volumeBySecond.set(sec, (s.volumeBySecond.get(sec) ?? 0) + ethAmount);
    s.totalVolume += ethAmount;
    const c = s.candle;
    if (c && c.t === sec) {
      c.h = Math.max(c.h, price);
      c.l = Math.min(c.l, price);
      c.c = price;
      c.v += ethAmount;
    } else {
      if (c) this.broadcast(round.id, { type: "candle", roundId: round.id, candle: c });
      s.candle = { t: sec, o: c?.c ?? price, h: price, l: price, c: price, v: ethAmount };
    }
    this.broadcast(round.id, { type: "trade", trade });
    return trade;
  }

  /** Post-trade bookkeeping: peaks, milestones, leader changes, rug drain. */
  private afterTrade(round: Round, now: number): void {
    if (round.state !== "live") return;
    const s = this.liveState(round.id);
    const pool = round.pool!;
    const price = spotPrice(pool);
    const mcap = marketCap(pool);
    if (price > s.peakPrice) s.peakPrice = price;
    if (mcap > s.peakMcap) s.peakMcap = mcap;
    if (price < s.bottomPrice) {
      s.bottomPrice = price;
      s.bottomAt = now;
    }
    for (const ms of MCAP_MILESTONES) {
      if (mcap >= ms && !s.milestonesHit.includes(ms)) {
        s.milestonesHit.push(ms);
        this.kill(round, "mcap_milestone", `Market cap crossed ${ms} ETH`, now);
      }
    }
    const leader = this.currentLeader(round);
    if (leader && leader !== s.leader) {
      s.leader = leader;
      this.kill(round, "new_leader", `${short(leader)} took the PnL lead`, now);
    }
    if (round.config.mcapTarget > 0 && mcap >= round.config.mcapTarget) {
      this.endRound(round, "mcap_target", now);
      return;
    }
    this.checkRugDrain(round, now);
  }

  private currentLeader(round: Round): Address | undefined {
    const positions = this.store.positions.get(round.id);
    if (!positions) return undefined;
    const price = spotPrice(round.pool!);
    let best: Address | undefined;
    let bestPnl = -Infinity;
    for (const p of positions.values()) {
      const pnl = p.realizedPnl + p.tokens * price - p.costBasisEth;
      if (pnl > bestPnl) {
        bestPnl = pnl;
        best = p.userAddress;
      }
    }
    return best;
  }

  private checkRugDrain(round: Round, now: number): void {
    const s = this.liveState(round.id);
    const sec = Math.floor(now / 1000);
    const reserve = round.pool!.ethReserve;
    s.reserveBySecond.set(sec, reserve);
    let maxRecent = reserve;
    for (let t = sec - RUG_WINDOW_SECONDS; t <= sec; t++) {
      const r = s.reserveBySecond.get(t);
      if (r !== undefined && r > maxRecent) maxRecent = r;
    }
    if (reserve <= maxRecent * (1 - RUG_DRAIN_FRACTION)) {
      this.endRound(round, "rug_detected", now);
    }
  }

  private tickLive(round: Round, now: number): void {
    const s = this.liveState(round.id);
    if (s.paused) return;
    const sec = Math.floor(now / 1000);
    const pool = round.pool!;
    const price = spotPrice(pool);

    // Close out the previous candle and keep the chart continuous.
    if (s.candle && s.candle.t < sec) {
      this.broadcast(round.id, { type: "candle", roundId: round.id, candle: s.candle });
      s.candle = { t: sec, o: s.candle.c, h: price, l: price, c: price, v: 0 };
    } else if (!s.candle) {
      s.candle = { t: sec, o: price, h: price, l: price, c: price, v: 0 };
    }

    const positions = this.store.positions.get(round.id);
    let holders = 0;
    if (positions) for (const p of positions.values()) if (p.tokens > 0) holders++;
    // Track worst drawdown per player for the Comeback Kid achievement.
    if (positions)
      for (const p of positions.values()) {
        if (p.costBasisEth > 0) {
          const frac = (p.realizedPnl + p.tokens * price - p.costBasisEth) / p.costBasisEth;
          const m = this.meta(round.id, p.userAddress);
          if (frac < m.minPnlFrac) m.minPnlFrac = frac;
        }
      }

    // "Cooking" flavor flag: notable volume in the last 30s relative to pool
    // depth. Shown alongside real numbers, never replacing them (spec §1).
    let recent30 = 0;
    for (let t = sec - 30; t <= sec; t++) recent30 += s.volumeBySecond.get(t) ?? 0;
    const cooking = recent30 >= Math.max(2, pool.ethReserve * 0.1);

    this.broadcast(round.id, {
      type: "ticker",
      roundId: round.id,
      price,
      mcap: marketCap(pool),
      liquidity: pool.ethReserve,
      volume: s.totalVolume,
      holders,
      ageSeconds: Math.floor((now - round.liveAt!) / 1000),
      cooking,
    });

    if (now >= round.endsAt!) {
      this.endRound(round, "timer", now);
      return;
    }
    // Low-volume ending: quiet for the configured window.
    const windowSec = round.config.lowVolumeWindowSeconds;
    if (now - round.liveAt! > windowSec * 1000) {
      let recent = 0;
      for (let t = sec - windowSec; t <= sec; t++) recent += s.volumeBySecond.get(t) ?? 0;
      if (recent < round.config.lowVolumeThreshold) {
        this.endRound(round, "low_volume", now);
      }
    }
  }

  /** Admin: simulate a liquidity pull (paper-mode test tool; always logged). */
  simulateLiquidityPull(roundId: string, now: number): void {
    const round = this.mustRound(roundId);
    if (round.state !== "live") throw new Err(409, "round is not live");
    round.pool!.ethReserve *= 0.1;
    this.kill(round, "rug_detected", "Liquidity removed", now);
    this.endRound(round, "liquidity_removed", now);
  }

  setPaused(roundId: string, paused: boolean, now: number): void {
    const round = this.mustRound(roundId);
    const s = this.liveState(roundId);
    if (paused && !s.paused) {
      s.paused = true;
      s.pausedAt = now;
    } else if (!paused && s.paused) {
      s.paused = false;
      if (s.pausedAt && round.endsAt) round.endsAt += now - s.pausedAt;
      s.pausedAt = undefined;
    }
    this.emitState(round);
  }

  isPaused(roundId: string): boolean {
    return this.live.get(roundId)?.paused ?? false;
  }

  endRound(round: Round, reason: RoundEndReason, now: number): void {
    if (round.state !== "live") return;
    round.state = "ended";
    round.endedAt = now;
    round.endReason = reason;
    if (reason === "rug_detected")
      this.kill(round, "rug_detected", "Rug detected — liquidity drained", now);
    this.emitState(round);

    const s = this.liveState(round.id);
    const pool = round.pool!;
    const positions = this.store.positions.get(round.id) ?? new Map();
    const holdersAtEnd = [...positions.values()].filter((p) => p.tokens > 0);
    const finalMcap = marketCap(pool);
    const finalPrice = spotPrice(pool);

    const cfg = round.config;
    const graduated =
      reason !== "rug_detected" &&
      reason !== "liquidity_removed" &&
      finalMcap >= cfg.graduationMcap &&
      holdersAtEnd.length >= cfg.graduationMinHolders &&
      s.totalVolume >= cfg.graduationMinVolume;
    round.graduated = graduated;

    if (graduated) {
      // Liquidity locks in a permanent pool; holders keep their tokens and
      // positions are marked to the final price (paper equivalent of the
      // spec's migrate-to-locked-DEX-pool mechanic).
      for (const p of holdersAtEnd) {
        p.realizedPnl += p.tokens * finalPrice - p.costBasisEth;
      }
      this.kill(round, "graduated", `${round.token.symbol} graduated — Arena Alumni`, now);
      const concept = this.store.concepts.get(round.conceptId);
      if (concept) concept.status = "launched";
    } else {
      // Uniform batch redemption: every remaining holder exits at one price,
      // E*O/(T+O) split pro-rata — no exit-order advantage at resolution.
      const outstanding = holdersAtEnd.reduce((sum, p) => sum + p.tokens, 0);
      if (outstanding > 0) {
        const ethOut = (pool.ethReserve * outstanding) / (pool.tokenReserve + outstanding);
        for (const p of holdersAtEnd) {
          const share = ethOut * (p.tokens / outstanding);
          this.store.getOrCreateUser(p.userAddress).paperBalance += share;
          p.realizedPnl += share - p.costBasisEth;
          p.tokens = 0;
          p.costBasisEth = 0;
        }
        pool.ethReserve -= ethOut;
        pool.tokenReserve += outstanding;
      }
    }

    const summary = evaluateRoundEnd({
      store: this.store,
      round,
      meta: s.meta,
      totalVolume: s.totalVolume,
      peakMcap: s.peakMcap,
      finalMcap,
      finalPrice,
      holderCount: holdersAtEnd.length,
      now,
    });
    this.store.summaries.set(round.id, summary);
    this.broadcast(round.id, { type: "round_end", roundId: round.id, summary });
    round.state = "results";
    this.emitState(round);
  }

  predictionCounts(roundId: string): { moon: number; rug: number } {
    const preds = this.store.predictions.get(roundId);
    let moon = 0;
    let rug = 0;
    if (preds) for (const p of preds.values()) p.call === "moon" ? moon++ : rug++;
    return { moon, rug };
  }

  private kill(round: Round, kind: KillFeedKind, text: string, now: number): void {
    const event = { id: this.store.id(), roundId: round.id, kind, text, at: now };
    let list = this.store.killfeed.get(round.id);
    if (!list) {
      list = [];
      this.store.killfeed.set(round.id, list);
    }
    list.push(event);
    this.broadcast(round.id, { type: "killfeed", event });
  }

  private emitState(round: Round): void {
    this.broadcast(round.id, { type: "round_state", round });
  }

  private emitLobby(round: Round): void {
    const intents = this.store.intents.get(round.id) ?? [];
    const committed = intents.reduce((s, i) => s + i.ethAmount, 0);
    const players = new Set(intents.map((i) => i.userAddress)).size;
    this.broadcast(round.id, {
      type: "lobby_update",
      roundId: round.id,
      players,
      spectators: this.spectatorCount(round.id),
      committedEth: committed,
      avgEntry: players > 0 ? committed / players : 0,
      queueDepth: intents.length,
    });
  }

  private mustRound(roundId: string): Round {
    const round = this.store.rounds.get(roundId);
    if (!round) throw new Err(404, "round not found");
    return round;
  }
}

export class Err extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmt(n: number): string {
  return n >= 1 ? n.toFixed(2) : n.toPrecision(2);
}
