/**
 * The paper bot swarm — a crowd to trade against on the paper beta.
 *
 * Each bot is a real store user (10 pETH, normalized at every lobby) driving
 * the same engine paths a human does: lobby trash talk, staggered pull-ups in
 * the queue, and profit-seeking live trading with distinct personalities —
 * scalpers take profits, diamond hands ride to the bell, fomo chasers buy
 * momentum, dip buyers fade the panic, paper hands stop out early.
 *
 * Bots never touch chain rounds (real money is humans-only), and they are
 * excluded from weekly jackpot payouts so real players always win the pot.
 * Enabled unless BOTS=0; always off on CHAIN_ONLY deployments.
 */
import { spotPrice, type ChatMessage, type Round } from "@cookout/shared";
import type { Broadcast, RoundEngine } from "./engine.js";
import type { Store } from "./store.js";

interface Persona {
  address: string;
  name: string;
  /** 0..1 — how often they talk. */
  chatty: number;
  /** Queue join point as a fraction of the queue window. */
  joinFrac: number;
  /** Pull-up size range (pETH). */
  intent: [number, number];
  /** Live buy size range (pETH). */
  clip: [number, number];
  /** Sell when price/entry - 1 exceeds this. */
  takeProfit: number;
  /** Sell everything when price/entry - 1 drops below this. */
  stopLoss: number;
  /** Buy when price sags this far below the round peak. */
  dipBuy: number;
  /** Chance per decision to chase a fresh pump. */
  fomo: number;
  /** Seconds between decisions [min, max]. */
  pace: [number, number];
  /** Diamond hands: ignore takeProfit until the final stretch. */
  diamond?: boolean;
}

const P = (
  i: number,
  name: string,
  o: Omit<Persona, "address" | "name">,
): Persona => ({
  address: `0xb07000000000000000000000000000000000${String(i).padStart(4, "0")}`.toLowerCase(),
  name,
  ...o,
});

export const PERSONAS: Persona[] = [
  P(1, "Grillmaster", { chatty: 0.9, joinFrac: 0.15, intent: [0.15, 0.3], clip: [0.05, 0.12], takeProfit: 0.35, stopLoss: -0.35, dipBuy: 0.12, fomo: 0.3, pace: [4, 9] }),
  P(2, "DiamondDan", { chatty: 0.5, joinFrac: 0.2, intent: [0.2, 0.3], clip: [0.04, 0.08], takeProfit: 1.5, stopLoss: -0.8, dipBuy: 0.2, fomo: 0.1, pace: [8, 16], diamond: true }),
  P(3, "degen_kate", { chatty: 0.8, joinFrac: 0.05, intent: [0.1, 0.25], clip: [0.06, 0.15], takeProfit: 0.2, stopLoss: -0.25, dipBuy: 0.08, fomo: 0.5, pace: [3, 7] }),
  P(4, "TapeReader", { chatty: 0.4, joinFrac: 0.5, intent: [0.08, 0.18], clip: [0.03, 0.08], takeProfit: 0.15, stopLoss: -0.12, dipBuy: 0.06, fomo: 0.15, pace: [4, 8] }),
  P(5, "ape_ceo", { chatty: 0.7, joinFrac: 0.1, intent: [0.2, 0.3], clip: [0.08, 0.15], takeProfit: 0.5, stopLoss: -0.5, dipBuy: 0.15, fomo: 0.45, pace: [5, 10] }),
  P(6, "solsurfer", { chatty: 0.6, joinFrac: 0.35, intent: [0.1, 0.2], clip: [0.04, 0.1], takeProfit: 0.3, stopLoss: -0.3, dipBuy: 0.1, fomo: 0.25, pace: [5, 11] }),
  P(7, "notfinancial", { chatty: 0.75, joinFrac: 0.6, intent: [0.05, 0.15], clip: [0.02, 0.06], takeProfit: 0.25, stopLoss: -0.2, dipBuy: 0.1, fomo: 0.2, pace: [6, 12] }),
  P(8, "0xWhale", { chatty: 0.2, joinFrac: 0.75, intent: [0.25, 0.3], clip: [0.1, 0.15], takeProfit: 0.4, stopLoss: -0.4, dipBuy: 0.18, fomo: 0.1, pace: [10, 20] }),
  P(9, "paperhand_pete", { chatty: 0.65, joinFrac: 0.3, intent: [0.05, 0.12], clip: [0.02, 0.05], takeProfit: 0.08, stopLoss: -0.08, dipBuy: 0.05, fomo: 0.3, pace: [3, 6] }),
  P(10, "fomo_fred", { chatty: 0.7, joinFrac: 0.85, intent: [0.08, 0.2], clip: [0.05, 0.12], takeProfit: 0.3, stopLoss: -0.35, dipBuy: 0.25, fomo: 0.7, pace: [3, 7] }),
  P(11, "quiet_scalper", { chatty: 0.1, joinFrac: 0.4, intent: [0.08, 0.16], clip: [0.03, 0.07], takeProfit: 0.12, stopLoss: -0.1, dipBuy: 0.05, fomo: 0.2, pace: [3, 6] }),
  P(12, "moon_mama", { chatty: 0.85, joinFrac: 0.25, intent: [0.12, 0.25], clip: [0.05, 0.1], takeProfit: 0.6, stopLoss: -0.45, dipBuy: 0.15, fomo: 0.35, pace: [6, 12] }),
  P(13, "rugdar", { chatty: 0.55, joinFrac: 0.45, intent: [0.06, 0.15], clip: [0.03, 0.08], takeProfit: 0.2, stopLoss: -0.15, dipBuy: 0.08, fomo: 0.1, pace: [5, 10] }),
  P(14, "chef_curry", { chatty: 0.6, joinFrac: 0.55, intent: [0.1, 0.22], clip: [0.04, 0.1], takeProfit: 0.28, stopLoss: -0.3, dipBuy: 0.12, fomo: 0.3, pace: [4, 9] }),
];

/** For jackpot/leaderboard filters: the swarm never wins real rewards. */
export const BOT_ADDRESSES = new Set(PERSONAS.map((p) => p.address));

// ---------------- chat flavor ----------------

const LOBBY_LINES = [
  "who's cooking tonight 👨‍🍳", "pulling up with the whole squad", "this one smells like a runner",
  "chart gonna be a heater i can feel it", "last round rugged me, revenge arc time",
  "everybody in? don't be late to the queue", "theme is fire ngl", "wallet warmed up lets go",
  "i said i'd take a break. i lied", "first candle decides everything, watch",
];
const QUEUE_LINES = [
  "pulled up 🫡", "im in. size = conviction", "limit set, not chasing", "locked in ✅",
  "fair open means nobody front-runs me, love it", "who else is in the queue rn",
  "pro rata me harder", "this queue filling FAST", "small entry, big dreams",
];
const PUMP_LINES = [
  "IT'S COOKING 🔥", "up only szn", "told y'all", "chart going vertical lmaooo",
  "whoever just market bought — respect", "printing. simply printing.", "don't you dare sell",
  "mcap about to break the target watch", "green candles taste better at night",
];
const DUMP_LINES = [
  "who is DUMPING", "chill chill chill", "buying this dip, thank me later",
  "paper hands everywhere smh", "this is the shakeout, hold", "pain.", "someone got liquidated fr",
  "exit liquidity? not me", "down bad but not out",
];
const WIN_LINES = [
  "secured the bag 💰", "and THAT'S how it's done", "profit is profit", "gg pay me",
  "sold the top, kissed the sky", "green. as. always.", "that's lunch money right there",
  "took profit, no regrets", "exit game strong today", "scalped it clean 🔪",
];
const LOSS_LINES = [
  "it's paper money it's paper money it's paper money", "charging that one to the game",
  "next round i'm him, watch", "rugged again. classic.", "stop loss said enough",
  "i was early, market was wrong", "down bad. still here.", "who sold on me 😤",
];
const GG_LINES = ["gg wp", "good round, run it back", "next lobby same energy", "that ending was cinema"];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// ---------------- per-round bot state ----------------

interface BotRoundState {
  planQueueAt: number;
  joined: boolean;
  nextActAt: number;
  nextChatAt: number;
  saidGg: boolean;
  lastPhase: string;
}

export class BotSwarm {
  /** roundId → persona.address → state */
  private state = new Map<string, Map<string, BotRoundState>>();
  private normalized = new Set<string>();

  constructor(
    private store: Store,
    private engine: RoundEngine,
    private broadcast: Broadcast,
  ) {
    for (const p of PERSONAS) {
      const u = this.store.getOrCreateUser(p.address);
      u.displayName = p.name;
    }
  }

  tick(now: number): void {
    for (const round of this.store.rounds.values()) {
      if (round.chain) continue; // real-money rounds are humans-only
      const phase = round.state;
      if (phase === "lobby" || phase === "queue_open") this.preRound(round, now);
      else if (phase === "live") this.live(round, now);
      else if (phase === "results" || phase === "ended") this.wrapUp(round, now);
    }
    // Drop state for rounds long gone.
    for (const id of this.state.keys()) {
      const r = this.store.rounds.get(id);
      if (!r || r.state === "results" || r.state === "ended") {
        const endedAt = r?.endedAt ?? 0;
        if (!r || now - endedAt > 60_000) this.state.delete(id);
      }
    }
  }

  private botState(round: Round, p: Persona, now: number): BotRoundState {
    let m = this.state.get(round.id);
    if (!m) {
      m = new Map();
      this.state.set(round.id, m);
    }
    let s = m.get(p.address);
    if (!s) {
      s = {
        planQueueAt: 0,
        joined: false,
        nextActAt: now + rand(2, 12) * 1000,
        nextChatAt: now + rand(3, 25) * 1000,
        saidGg: false,
        lastPhase: "",
      };
      m.set(p.address, s);
    }
    return s;
  }

  /** Lobby chatter + staggered queue pull-ups. */
  private preRound(round: Round, now: number): void {
    // Fresh round: everyone gets exactly 10 pETH — a level swarm every time.
    if (!this.normalized.has(round.id)) {
      this.normalized.add(round.id);
      for (const p of PERSONAS) this.store.getOrCreateUser(p.address).paperBalance = 10;
      if (this.normalized.size > 50) this.normalized.clear();
    }
    for (const p of PERSONAS) {
      const s = this.botState(round, p, now);
      // Chat: lobby hype, queue talk once they're in.
      if (now >= s.nextChatAt && Math.random() < p.chatty * 0.5) {
        this.say(round, p, s.joined ? pick(QUEUE_LINES) : pick(LOBBY_LINES));
        s.nextChatAt = now + rand(20, 70) * 1000;
      }
      // Pull up at each persona's planned point in the queue window.
      if (round.state === "queue_open" && !s.joined) {
        if (!s.planQueueAt && round.queueOpensAt && round.queueClosesAt) {
          const span = round.queueClosesAt - round.queueOpensAt;
          s.planQueueAt = round.queueOpensAt + span * (p.joinFrac + rand(-0.05, 0.05));
        }
        if (s.planQueueAt && now >= s.planQueueAt) {
          s.joined = true;
          try {
            const size = Math.min(rand(p.intent[0], p.intent[1]), round.config.maxPositionEth || 1);
            this.engine.submitIntent(round.id, p.address, Number(size.toFixed(3)), undefined, now);
            if (Math.random() < p.chatty * 0.6) this.say(round, p, pick(QUEUE_LINES));
          } catch {
            /* cap/balance — sit this one out */
          }
        }
      }
    }
  }

  /** Live trading: profit-seeking decisions per persona. */
  private live(round: Round, now: number): void {
    const pool = round.pool;
    if (!pool || !round.liveAt || !round.endsAt) return;
    const price = spotPrice(pool);
    const s0 = this.store.candles.get(round.id);
    const peak = Math.max(price, ...(s0?.slice(-90).map((c) => c.h) ?? [price]));
    const momentum = this.momentum(round.id, price);
    const progress = (now - round.liveAt) / (round.endsAt - round.liveAt);

    for (const p of PERSONAS) {
      const s = this.botState(round, p, now);
      if (now < s.nextActAt) continue;
      s.nextActAt = now + rand(p.pace[0], p.pace[1]) * 1000;

      const pos = this.store.position(round.id, p.address);
      const entry = pos.tokens > 0 ? pos.costBasisEth / pos.tokens : 0;
      try {
        if (pos.tokens > 0 && entry > 0) {
          const pnlFrac = price / entry - 1;
          const lastStretch = progress > 0.82;
          if (pnlFrac <= p.stopLoss) {
            this.engine.trade(round.id, p.address, "sell", { pct: 100 }, now);
            if (Math.random() < p.chatty * 0.5) this.say(round, p, pick(LOSS_LINES));
            continue;
          }
          const tp = p.diamond && !lastStretch ? Infinity : p.takeProfit;
          if (pnlFrac >= tp) {
            const pct = Math.random() < 0.5 ? 50 : 100;
            this.engine.trade(round.id, p.address, "sell", { pct }, now);
            if (Math.random() < p.chatty * 0.6) this.say(round, p, pick(WIN_LINES));
            continue;
          }
          // Scalpers trim into strength late in the round.
          if (lastStretch && !p.diamond && pnlFrac > 0 && Math.random() < 0.4) {
            this.engine.trade(round.id, p.address, "sell", { pct: 50 }, now);
            continue;
          }
        }
        // Entries: dips, momentum, or plain conviction.
        const user = this.store.getOrCreateUser(p.address);
        const dip = peak > 0 && price < peak * (1 - p.dipBuy);
        const chase = momentum > 0.04 && Math.random() < p.fomo;
        const cold = pos.tokens === 0 && Math.random() < 0.12;
        if ((dip || chase || cold) && user.paperBalance > 0.05 && progress < 0.9) {
          const size = Math.min(rand(p.clip[0], p.clip[1]), user.paperBalance * 0.5);
          this.engine.trade(round.id, p.address, "buy", { eth: Number(size.toFixed(3)) }, now);
          if (chase && Math.random() < p.chatty * 0.4) this.say(round, p, pick(PUMP_LINES));
          if (dip && Math.random() < p.chatty * 0.4) this.say(round, p, pick(DUMP_LINES));
        }
      } catch {
        /* position caps, dev locks, paused — bots just wait */
      }
      // Ambient commentary on strong moves.
      if (now >= s.nextChatAt && Math.random() < p.chatty * 0.35) {
        if (momentum > 0.05) this.say(round, p, pick(PUMP_LINES));
        else if (momentum < -0.05) this.say(round, p, pick(DUMP_LINES));
        s.nextChatAt = now + rand(25, 80) * 1000;
      }
    }
  }

  private wrapUp(round: Round, now: number): void {
    const m = this.state.get(round.id);
    if (!m) return;
    for (const p of PERSONAS) {
      const s = m.get(p.address);
      if (!s || s.saidGg) continue;
      s.saidGg = true;
      if (Math.random() < p.chatty * 0.4) this.say(round, p, pick(GG_LINES));
    }
  }

  /** ~10s price momentum from the candle tail. */
  private momentum(roundId: string, price: number): number {
    const candles = this.store.candles.get(roundId);
    if (!candles || candles.length === 0) return 0;
    const ref = candles[Math.max(0, candles.length - 10)]!;
    return ref.o > 0 ? price / ref.o - 1 : 0;
  }

  /** Post a chat message exactly the way the WS handler does. */
  private say(round: Round, p: Persona, text: string): void {
    const message: ChatMessage = {
      id: this.store.id(),
      roundId: round.id,
      userAddress: p.address,
      displayName: p.name,
      text,
      at: Date.now(),
    };
    let list = this.store.chat.get(round.id);
    if (!list) {
      list = [];
      this.store.chat.set(round.id, list);
    }
    list.push(message);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.broadcast(round.id, { type: "chat", message });
  }
}
