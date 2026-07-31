/**
 * The Swarm AI Director — the living opponent players battle in The Pit.
 *
 * It does not spam orders or predetermine winners. For each live Pit round it
 * advances a believable market *story* (accumulation, momentum runs, fake
 * recoveries, panic selloffs, distribution, blow-off tops, late rugs, recovery
 * rallies) by driving the same engine.trade path the paper swarm uses, from the
 * same 0xb07… bot addresses (so it is excluded from every reward). Behavior
 * scales with the match duration and the admin Aggression / Difficulty knobs.
 *
 * Unlike the Cookout bot swarm, the Director is always on for Pit rounds — the
 * Swarm is the whole point of the mode — and ignores the store.settings.bots
 * toggle, which governs the Cookout swarm only.
 */
import { marketCap, spotPrice, type Round } from "@cookout/shared";
import { PERSONAS } from "./bots.js";
import type { RoundEngine, SystemChat } from "./engine.js";
import type { Store } from "./store.js";

type Phase =
  | "accumulation"
  | "momentum"
  | "fake_recovery"
  | "distribution"
  | "panic"
  | "recovery"
  | "blowoff"
  | "graduate_push"
  | "rug"
  | "coast";

/** Buy probability + size bias per phase. Size is a fraction of pool depth. */
const PHASE: Record<Phase, { buy: number; size: number; label?: string }> = {
  accumulation: { buy: 0.72, size: 0.05, label: "The Goon Squad is accumulating." },
  momentum: { buy: 0.86, size: 0.1, label: "Momentum run. The Goons are bidding it up." },
  fake_recovery: { buy: 0.68, size: 0.07, label: "The Goon Squad is faking a recovery." },
  distribution: { buy: 0.42, size: 0.06, label: "The Goons are distributing into strength." },
  panic: { buy: 0.14, size: 0.11, label: "Panic selling detected." },
  recovery: { buy: 0.76, size: 0.08, label: "The Goon Squad is buying the panic." },
  blowoff: { buy: 0.9, size: 0.13, label: "Blow-off top forming." },
  graduate_push: { buy: 0.95, size: 0.16, label: "The Goons are sending it toward the bond." },
  rug: { buy: 0.0, size: 0.2, label: "The Goon Squad is pulling the market." },
  coast: { buy: 0.5, size: 0.04 },
};

/** Pre-endgame phase sequence per duration. */
const SEQUENCE: Record<string, Phase[]> = {
  blitz: ["momentum", "panic"],
  standard: ["accumulation", "momentum", "fake_recovery", "distribution"],
  marathon: ["accumulation", "momentum", "distribution", "fake_recovery", "panic", "recovery"],
};

interface DirectorState {
  nextActAt: number;
  announced: Set<Phase>;
  finalCalled: boolean;
  /** Chosen endgame, decided once when the endgame window opens. */
  endgame?: "graduate_push" | "rug" | "coast";
  rugFired: boolean;
}

const bots = PERSONAS.map((p) => p.address);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

export class SwarmDirector {
  private state = new Map<string, DirectorState>();

  constructor(
    private store: Store,
    private engine: RoundEngine,
    private sys: SystemChat,
  ) {}

  /** Drive every live Pit round one step. Call on the engine tick. */
  tick(now: number): void {
    for (const round of this.store.rounds.values()) {
      if (round.matchType !== "pit" || round.state !== "live" || !round.pool) continue;
      try {
        this.driveRound(round, now);
      } catch {
        // A single bad trade (nothing to sell, paused) never stalls the Director.
      }
    }
    // Drop state for rounds that have ended.
    for (const id of [...this.state.keys()])
      if (this.store.rounds.get(id)?.state !== "live") this.state.delete(id);
  }

  private driveRound(round: Round, now: number): void {
    const st = this.stateFor(round.id);
    const pit = round.pit!;
    const cfg = this.store.settings.pit;
    const liveAt = round.liveAt ?? now;
    const endsAt = round.endsAt ?? now;
    const total = Math.max(1, endsAt - liveAt);
    const frac = Math.min(1, (now - liveAt) / total);

    // The endgame occupies the final stretch; pick its shape once.
    const endgameFrac = round.pit!.duration === "blitz" ? 0.72 : 0.82;
    let phase: Phase;
    if (frac >= endgameFrac) {
      if (!st.endgame) st.endgame = this.chooseEndgame(round);
      phase = st.endgame;
    } else {
      const seq = SEQUENCE[pit.duration] ?? SEQUENCE.standard!;
      const idx = Math.min(seq.length - 1, Math.floor((frac / endgameFrac) * seq.length));
      phase = seq[idx]!;
    }

    // Announce a phase the first time we enter it (Swarm system messages).
    const spec = PHASE[phase];
    if (spec.label && !st.announced.has(phase)) {
      st.announced.add(phase);
      this.sys(round.id, "pit_event", `Flame Goon Squad: ${spec.label}`);
    }
    // Final-ten-seconds call, once.
    if (!st.finalCalled && endsAt - now <= 10_000 && endsAt - now > 0) {
      st.finalCalled = true;
      this.sys(round.id, "pit_event", "Final 10 seconds. Lock in your exits.");
    }

    // A late rug: dump hard, then pull the market.
    if (phase === "rug" && !st.rugFired) {
      this.dumpAll(round, now);
      if (frac >= 0.9) {
        st.rugFired = true;
        this.engine.endRound(round, "rug_detected", now);
        return;
      }
    }

    // Paced actions. Faster with higher aggression and on shorter matches.
    if (now < st.nextActAt) return;
    const base = pit.duration === "blitz" ? 550 : pit.duration === "marathon" ? 1600 : 1000;
    st.nextActAt = now + base / (0.5 + cfg.aggression);
    this.act(round, phase, now);
  }

  /** One Swarm order in the current phase's direction. */
  private act(round: Round, phase: Phase, now: number): void {
    const spec = PHASE[phase];
    const cfg = this.store.settings.pit;
    const pool = round.pool!;
    const addr = pick(bots);
    const buying = Math.random() < spec.buy;
    if (buying) {
      const size = pool.ethReserve * spec.size * (0.6 + cfg.aggression) * (0.6 + Math.random() * 0.8);
      const eth = Math.max(0.01, Number(size.toFixed(4)));
      this.engine.trade(round.id, addr, "buy", { eth }, now);
    } else {
      const pos = this.store.position(round.id, addr);
      if (pos.tokens > 1e-9) {
        const pct = phase === "panic" ? 60 + Math.random() * 40 : 25 + Math.random() * 40;
        this.engine.trade(round.id, addr, "sell", { pct: Math.round(pct) }, now);
      } else {
        // Nothing to sell — keep the tape alive with a small buy.
        const eth = Math.max(0.01, Number((pool.ethReserve * 0.03).toFixed(4)));
        this.engine.trade(round.id, addr, "buy", { eth }, now);
      }
    }
  }

  /** Sell every Swarm bot's position — the mechanical part of a rug. */
  private dumpAll(round: Round, now: number): void {
    for (const addr of bots) {
      const pos = this.store.position(round.id, addr);
      if (pos.tokens > 1e-9) {
        try {
          this.engine.trade(round.id, addr, "sell", { pct: 100 }, now);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Decide how a match ends when the endgame window opens. Never predetermined
   * from the start and never a function of who predicted what — it reads the
   * live market: a strong, climbing market is allowed to graduate; a weak or
   * toppy one is more likely to get rugged; otherwise it coasts to the timer.
   * Difficulty nudges toward the harder (rug) outcome.
   */
  private chooseEndgame(round: Round): "graduate_push" | "rug" | "coast" {
    const cfg = this.store.settings.pit;
    const pool = round.pool!;
    const mcap = marketCap(pool);
    const grad = round.config.graduationMcap;
    const price = spotPrice(pool);
    const nearBond = mcap >= grad * 0.6;
    const r = Math.random();
    if (nearBond && price > 0 && r > 0.35 + cfg.difficulty * 0.25) return "graduate_push";
    if (r < 0.35 + cfg.difficulty * 0.3) return "rug";
    return "coast";
  }

  private stateFor(id: string): DirectorState {
    let st = this.state.get(id);
    if (!st) {
      st = { nextActAt: 0, announced: new Set(), finalCalled: false, rugFired: false };
      this.state.set(id, st);
    }
    return st;
  }
}
