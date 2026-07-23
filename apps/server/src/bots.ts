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
  // ---- crowd personas ----
  // Loud, near-broke spectators. They fill the room and keep chat alive in the
  // quiet regimes (fade/dead) where few real traders pull up — but they carry
  // tiny size, so they add atmosphere without tilting the graduation math.
  P(15, "grill_groupie", { chatty: 0.98, joinFrac: 0.2, intent: [0.02, 0.05], clip: [0.02, 0.04], takeProfit: 0.2, stopLoss: -0.2, dipBuy: 0.06, fomo: 0.4, pace: [3, 7] }),
  P(16, "sauce_boss", { chatty: 0.92, joinFrac: 0.35, intent: [0.02, 0.06], clip: [0.02, 0.05], takeProfit: 0.25, stopLoss: -0.25, dipBuy: 0.08, fomo: 0.35, pace: [3, 8] }),
  P(17, "nocoiner_carl", { chatty: 0.88, joinFrac: 0.9, intent: [0.02, 0.04], clip: [0.02, 0.03], takeProfit: 0.15, stopLoss: -0.15, dipBuy: 0.05, fomo: 0.15, pace: [4, 9] }),
  P(18, "hype_hazel", { chatty: 0.97, joinFrac: 0.15, intent: [0.03, 0.06], clip: [0.02, 0.05], takeProfit: 0.35, stopLoss: -0.4, dipBuy: 0.1, fomo: 0.6, pace: [3, 6] }),
  P(19, "backseat_ben", { chatty: 0.95, joinFrac: 0.6, intent: [0.02, 0.05], clip: [0.02, 0.04], takeProfit: 0.2, stopLoss: -0.18, dipBuy: 0.07, fomo: 0.2, pace: [3, 7] }),
];

/** For jackpot/leaderboard filters: the swarm never wins real rewards. */
export const BOT_ADDRESSES = new Set(PERSONAS.map((p) => p.address));

// ---------------- per-round market regime ----------------

/**
 * The reason every round used to feel the same: the swarm was structurally
 * net-long (fomo chasers + dip buyers + diamond hands), so mcap crept to the
 * bond target almost every time and a human just had to sit there.
 *
 * A regime is rolled once per round and biases the WHOLE swarm — how many pull
 * up, how hard they buy, how fast they take profit, and how much they
 * distribute into strength regardless of P&L. Bearish regimes genuinely fail
 * to bond, so holding is now a real bet, not a formality.
 */
interface Regime {
  key: string;
  /** A kickoff read one bot drops in the lobby, so the mood is legible. */
  tell: string;
  /** Multiplier on buy triggers (fomo, cold entries, dip buys). */
  buyBias: number;
  /** Multiplier on buy clip size. */
  sizeBias: number;
  /** Multiplier on take-profit target (＜1 = sell sooner). */
  tpBias: number;
  /** Multiplier on stop distance (＜1 = tighter stops, panic sooner). */
  slBias: number;
  /** Per-decision chance a holder trims into the book regardless of P&L. */
  distribute: number;
  /** Fraction of the swarm that actually pulls up this round. */
  joinRate: number;
  /** Selection weight. */
  weight: number;
}

const REGIMES: Regime[] = [
  // Sometimes it really does run — but now it's the minority case.
  { key: "runner", tell: "this one smells like a RUNNER 🏃💨 faders gonna cry", buyBias: 1.45, sizeBias: 1.3, tpBias: 1.7, slBias: 1.4, distribute: 0.02, joinRate: 0.95, weight: 18 },
  { key: "grind", tell: "coin-flip vibes, gonna be a grind", buyBias: 1.05, sizeBias: 1.0, tpBias: 1.0, slBias: 1.0, distribute: 0.06, joinRate: 0.85, weight: 24 },
  { key: "chop", tell: "scalpers out in force, chop city today 🔪", buyBias: 0.9, sizeBias: 0.8, tpBias: 0.5, slBias: 0.75, distribute: 0.15, joinRate: 0.8, weight: 20 },
  { key: "fade", tell: "sell pressure looks heavy, mind your entries", buyBias: 0.6, sizeBias: 0.72, tpBias: 0.42, slBias: 0.6, distribute: 0.26, joinRate: 0.68, weight: 22 },
  { key: "dead", tell: "thin book, low energy lobby ngl", buyBias: 0.45, sizeBias: 0.6, tpBias: 0.5, slBias: 0.7, distribute: 0.16, joinRate: 0.48, weight: 16 },
];

const rollRegime = (): Regime => {
  const total = REGIMES.reduce((s, r) => s + r.weight, 0);
  let x = Math.random() * total;
  for (const r of REGIMES) if ((x -= r.weight) < 0) return r;
  return REGIMES[1]!;
};

/** Per-persona per-round multipliers so the same bot isn't identical each time. */
interface Jitter {
  tp: number;
  sl: number;
  fomo: number;
  clip: number;
  /** Distribution eagerness — scalper-ish bots sell into strength more. */
  distribute: number;
}

interface RoundPlan {
  regime: Regime;
  jitter: Map<string, Jitter>;
  toldMood: boolean;
}

// ---------------- chat flavor ----------------

const LOBBY_LINES = [
  "who's cooking tonight 👨‍🍳", "pulling up with the whole squad", "this one smells like a runner",
  "chart gonna be a heater i can feel it", "last round rugged me, revenge arc time",
  "everybody in? don't be late to the queue", "theme is fire ngl", "wallet warmed up lets go",
  "i said i'd take a break. i lied", "first candle decides everything, watch",
  "gm degens ☕", "what's the vibe this round", "i've got a good feeling about this one",
  "deposited, locked, loaded", "who's the dev, do we trust them 👀", "ticker actually goes hard",
  "back to back sessions, no sleep", "art is clean, i'm in", "praying for green candles fr",
  "someone talk me OUT of aping", "the lobby is buzzing tonight", "i'm not early i'm... on time",
  "chat let's get rowdy", "10 pETH says this runs", "new round who dis",
];
const QUEUE_LINES = [
  "pulled up 🫡", "im in. size = conviction", "limit set, not chasing", "locked in ✅",
  "fair open means nobody front-runs me, love it", "who else is in the queue rn",
  "pro rata me harder", "this queue filling FAST", "small entry, big dreams",
  "in at the open, no regrets", "queue looking THICC", "everyone settles same price, i love this game",
  "position set, hands washed", "not chasing the top this time i swear", "fair open >>> sniper bots",
  "we all in this together lets go", "committed. no takebacks.", "see you on the other side of settlement",
];
const PUMP_LINES = [
  "IT'S COOKING 🔥", "up only szn", "told y'all", "chart going vertical lmaooo",
  "whoever just market bought, respect", "printing. simply printing.", "don't you dare sell",
  "mcap about to break the target watch", "green candles taste better at night",
  "SEND IT 🚀", "we are SO back", "candles fatter than my portfolio", "bulls in full control",
  "i'm never selling (i will sell)", "this is financial advice, buy", "vertical. absolutely vertical.",
  "who's still not in?? ngmi", "momentum is INSANE rn", "bonding curve go brrr", "green dildo incoming 📈",
  "my hands? diamond. 💎🙌",
];
const DUMP_LINES = [
  "who is DUMPING", "chill chill chill", "buying this dip, thank me later",
  "paper hands everywhere smh", "this is the shakeout, hold", "pain.", "someone got liquidated fr",
  "exit liquidity? not me", "down bad but not out",
  "RED. so much red.", "why is everyone selling omg", "the dip is a gift, allegedly", "hold the line 🛡️",
  "my stop loss is my therapist", "who dropped the anvil on this chart", "blood in the streets rn",
  "i'm not panicking YOU'RE panicking", "this is fine 🔥🐶", "sell button looking real tempting",
  "capitulation station, all aboard 🚂", "down horrendous",
];
const WIN_LINES = [
  "secured the bag 💰", "and THAT'S how it's done", "profit is profit", "gg pay me",
  "sold the top, kissed the sky", "green. as. always.", "that's lunch money right there",
  "took profit, no regrets", "exit game strong today", "scalped it clean 🔪",
  "in and out, twenty minute adventure", "ty for the exit liquidity 🫶", "up only, as promised",
  "bought the fear, sold the greed", "textbook. absolutely textbook.", "another one for the highlight reel",
  "paid. moving on.", "called it in chat, screenshot it",
];
const LOSS_LINES = [
  "it's paper money it's paper money it's paper money", "charging that one to the game",
  "next round i'm him, watch", "rugged again. classic.", "stop loss said enough",
  "i was early, market was wrong", "down bad. still here.", "who sold on me 😤",
  "held too long, tale as old as time", "that's a paper cut, i'll live", "revenge trade loading...",
  "bought the top like a champion 🏆", "my conviction was a lie", "gg to whoever faded me",
  "lesson learned (it wasn't)", "back to the drawing board",
];
const GG_LINES = [
  "gg wp", "good round, run it back", "next lobby same energy", "that ending was cinema",
  "gg everyone 🫡", "well played chat", "same time next round?", "loved the chaos, do it again",
  "respect to the winners", "onto the next one",
];

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
  /** roundId → the regime + per-persona jitter rolled for that round. */
  private plans = new Map<string, RoundPlan>();

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
    this.voteOnConcepts(now);
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
        if (!r || now - endedAt > 60_000) {
          this.state.delete(id);
          this.plans.delete(id);
        }
      }
    }
  }

  /** When the auto-scheduler is off, the swarm keeps the voting booth alive:
   *  a bot vote lands every ~2.5–6.5s (bandwagon-weighted, so momentum
   *  snowballs the way real votes do) — beta pacing that walks a fresh coin to
   *  the 10-vote shortlist in about a minute instead of leaving the creator
   *  staring at zero. Bots use the same one-vote-per-address ledger as humans,
   *  and human votes always count alongside (and speed things up further). */
  private nextVoteAt = 0;
  private voteOnConcepts(now: number): void {
    if (this.store.settings.autoSchedule) return; // calendar fills itself — stay out
    if (now < this.nextVoteAt) return;
    this.nextVoteAt = now + 2_500 + Math.random() * 4_000;
    const open = [...this.store.concepts.values()].filter((c) => c.status === "submitted");
    if (open.length === 0) return;
    // Bandwagon-weighted pick: 1 + votes.
    const totalW = open.reduce((s, c) => s + 1 + c.votes, 0);
    let roll = Math.random() * totalW;
    let pick = open[0]!;
    for (const c of open) {
      roll -= 1 + c.votes;
      if (roll <= 0) {
        pick = c;
        break;
      }
    }
    let voters = this.store.conceptVoters.get(pick.id);
    if (!voters) {
      voters = new Set();
      this.store.conceptVoters.set(pick.id, voters);
    }
    const fresh = PERSONAS.filter((p) => !voters.has(p.address));
    if (fresh.length === 0) return;
    const p = fresh[Math.floor(Math.random() * fresh.length)]!;
    voters.add(p.address);
    pick.votes++;
  }

  /** The regime + jitter for a round, rolled once and cached. */
  private plan(round: Round): RoundPlan {
    let plan = this.plans.get(round.id);
    if (!plan) {
      const jitter = new Map<string, Jitter>();
      for (const p of PERSONAS) {
        // Natural sellers (low base take-profit) distribute more eagerly.
        const sellerish = p.takeProfit < 0.2 ? 1.6 : 1;
        jitter.set(p.address, {
          tp: rand(0.75, 1.3),
          sl: rand(0.8, 1.25),
          fomo: rand(0.6, 1.45),
          clip: rand(0.7, 1.4),
          distribute: rand(0.6, 1.5) * sellerish,
        });
      }
      plan = { regime: rollRegime(), jitter, toldMood: false };
      this.plans.set(round.id, plan);
    }
    return plan;
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
        nextActAt: now + rand(0.5, 5) * 1000,
        nextChatAt: now + rand(2, 18) * 1000,
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
      // Bots run the same rails as players: 10 pETH, all of it staked into
      // the arena balance so they can actually pull up.
      for (const p of PERSONAS) {
        const u = this.store.getOrCreateUser(p.address);
        u.paperBalance = 0;
        u.arenaBalance = 10;
      }
      if (this.normalized.size > 50) this.normalized.clear();
    }
    const plan = this.plan(round);

    // One bot reads the room at the open so the mood is visible in chat.
    if (round.state === "queue_open" && !plan.toldMood) {
      plan.toldMood = true;
      const crier = PERSONAS.filter((p) => p.chatty > 0.6);
      if (crier.length) this.say(round, pick(crier), plan.regime.tell);
    }

    for (const p of PERSONAS) {
      const s = this.botState(round, p, now);
      // Chat: lobby hype, queue talk once they're in.
      if (now >= s.nextChatAt && Math.random() < p.chatty * 0.5) {
        this.say(round, p, s.joined ? pick(QUEUE_LINES) : pick(LOBBY_LINES));
        s.nextChatAt = now + rand(15, 55) * 1000;
      }
      // Pull up at each persona's planned point in the queue window.
      if (round.state === "queue_open" && !s.joined) {
        if (!s.planQueueAt && round.queueOpensAt && round.queueClosesAt) {
          // Whether this bot shows up at all is a regime call — a dead lobby
          // has far fewer entries, which is a big part of why it won't bond.
          const jit = plan.jitter.get(p.address)!;
          if (Math.random() > plan.regime.joinRate) {
            s.joined = true; // "decided to sit this one out" — never queues
            s.planQueueAt = Infinity;
          } else {
            // Pack the pull-ups into the first ~55% of the window so the board
            // fills fast and visibly, instead of trickling in to the bell.
            const span = round.queueClosesAt! - round.queueOpensAt!;
            const frac = Math.min(0.6, Math.max(0.01, p.joinFrac * 0.55 + rand(0, 0.08)));
            s.planQueueAt = round.queueOpensAt! + span * frac;
            void jit;
          }
        }
        if (s.planQueueAt && s.planQueueAt !== Infinity && now >= s.planQueueAt) {
          s.joined = true;
          try {
            const jit = plan.jitter.get(p.address)!;
            const raw = rand(p.intent[0], p.intent[1]) * plan.regime.sizeBias * jit.clip;
            const size = Math.min(raw, round.config.maxPositionEth || 1);
            this.engine.submitIntent(round.id, p.address, Number(size.toFixed(3)), undefined, now);
            if (Math.random() < p.chatty * 0.6) this.say(round, p, pick(QUEUE_LINES));
          } catch {
            /* cap/balance — sit this one out */
          }
        }
      }
    }
  }

  /** Live trading: profit-seeking decisions per persona, tinted by the regime. */
  private live(round: Round, now: number): void {
    const pool = round.pool;
    if (!pool || !round.liveAt || !round.endsAt) return;
    const price = spotPrice(pool);
    const s0 = this.store.candles.get(round.id);
    const peak = Math.max(price, ...(s0?.slice(-90).map((c) => c.h) ?? [price]));
    const momentum = this.momentum(round.id, price);
    const progress = (now - round.liveAt) / (round.endsAt - round.liveAt);
    const { regime, jitter } = this.plan(round);

    for (const p of PERSONAS) {
      const s = this.botState(round, p, now);
      if (now < s.nextActAt) continue;
      s.nextActAt = now + rand(p.pace[0], p.pace[1]) * 1000;

      const jit = jitter.get(p.address)!;
      // Effective, regime-tinted thresholds for this bot this round.
      const takeProfit = p.takeProfit * regime.tpBias * jit.tp;
      const stopLoss = p.stopLoss * regime.slBias * jit.sl; // negative; ×＜1 = tighter
      const fomo = Math.min(0.95, p.fomo * regime.buyBias * jit.fomo);

      const pos = this.store.position(round.id, p.address);
      const entry = pos.tokens > 0 ? pos.costBasisEth / pos.tokens : 0;
      try {
        if (pos.tokens > 0 && entry > 0) {
          const pnlFrac = price / entry - 1;
          const lastStretch = progress > 0.82;
          if (pnlFrac <= stopLoss) {
            this.engine.trade(round.id, p.address, "sell", { pct: 100 }, now);
            if (Math.random() < p.chatty * 0.5) this.say(round, p, pick(LOSS_LINES));
            continue;
          }
          const tp = p.diamond && !lastStretch ? Infinity : takeProfit;
          if (pnlFrac >= tp) {
            const pct = Math.random() < 0.5 ? 50 : 100;
            this.engine.trade(round.id, p.address, "sell", { pct }, now);
            if (Math.random() < p.chatty * 0.6) this.say(round, p, pick(WIN_LINES));
            continue;
          }
          // Distribution: the crowd taking chips off the table regardless of
          // P&L. This is the sell pressure that stops every round bonding —
          // heavy in fade/chop regimes, almost nothing in a runner. Diamond
          // hands abstain until the final stretch.
          const distribute = p.diamond && !lastStretch ? 0 : regime.distribute * jit.distribute;
          if (Math.random() < distribute) {
            const pct = pnlFrac > 0.15 ? (Math.random() < 0.5 ? 50 : 33) : 25;
            this.engine.trade(round.id, p.address, "sell", { pct }, now);
            if (pnlFrac > 0 && Math.random() < p.chatty * 0.3) this.say(round, p, pick(WIN_LINES));
            continue;
          }
          // Scalpers trim into strength late in the round.
          if (lastStretch && !p.diamond && pnlFrac > 0 && Math.random() < 0.4) {
            this.engine.trade(round.id, p.address, "sell", { pct: 50 }, now);
            continue;
          }
        }
        // Entries: dips, momentum, or plain conviction — all gated by how
        // much the regime wants to buy.
        const user = this.store.getOrCreateUser(p.address);
        const dip = peak > 0 && price < peak * (1 - p.dipBuy) && Math.random() < 0.35 + regime.buyBias * 0.35;
        const chase = momentum > 0.04 && Math.random() < fomo;
        const cold = pos.tokens === 0 && Math.random() < 0.1 * regime.buyBias;
        const funds = user.arenaBalance ?? 0;
        if ((dip || chase || cold) && funds > 0.05 && progress < 0.9) {
          const size = Math.min(rand(p.clip[0], p.clip[1]) * regime.sizeBias * jit.clip, funds * 0.5);
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
