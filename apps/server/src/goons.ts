/**
 * The Flame Goon Squad AI — The Pit's resident personalities.
 *
 * Event-driven, never timer-scripted: gameplay reports "moments" (via
 * store.onPitMoment) and this engine decides — using cooldowns, human-priority,
 * per-persona chattiness, rarity, schedules, weighted anti-repeat dialogue,
 * continuity memory, and rivalries — whether anyone reacts, and with what line.
 * The Squad speaks in chat only: it never takes over the screen with a hero
 * banner. Players always come first: if a human just spoke, it mostly stays quiet.
 *
 * The Squad lives ONLY in The Pit (PIT_ROOM + individual match rooms). It never
 * posts to The Grill, the queue/lobby, or standard Cookout rounds. The accounts
 * are real store users (0x900d…) so /profile/<handle> works, but they never
 * trade and never earn.
 */
import {
  PIT_ROOM,
  isGoon,
  type ChatMessage,
  type GoonDialogueCategory,
  type GoonEventKind,
  type GoonMoment,
  type GoonPersona,
  type Round,
} from "@cookout/shared";
import type { Broadcast } from "./engine.js";
import type { Store } from "./store.js";

const CATEGORY: Record<GoonEventKind, GoonDialogueCategory> = {
  match_created: "matchCreated",
  live: "greeting",
  big_buy: "bigBuy",
  whale: "bigBuy",
  big_sell: "bigSell",
  rug: "rug",
  leader_change: "leaderChange",
  final_minute: "finalMinute",
  winner: "winner",
  upset: "upset",
  ambient: "ambient",
};

/** Marquee beats — important enough to break the players-first quiet rule. */
const MARQUEE = new Set<GoonEventKind>(["live", "whale", "rug", "winner", "upset"]);

const isNamed = (p: GoonPersona) => p.rarity === "legendary" || p.rarity === "epic";
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
/** Deterministic 0..1 hash of a string (for stable daily rotation). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return ((h >>> 0) % 1000) / 1000;
}

export class GoonSwarm {
  /** roomId → last time any Goon spoke there. */
  private lastAiAt = new Map<string, number>();
  /** persona handle → recently used lines (anti-repeat). */
  private recent = new Map<string, string[]>();
  /** roomId → last ambient chatter time. */
  private lastAmbient = new Map<string, number>();
  /** round ids that already fired their final-minute beat. */
  private firedFinal = new Set<string>();
  private registered = false;

  constructor(
    private store: Store,
    private broadcast: Broadcast,
  ) {
    this.register();
  }

  private get s() {
    return this.store.settings.goons;
  }

  /** Make every persona a real, profile-backed account and index its handle. */
  register(): void {
    for (const p of this.s.personas) {
      const u = this.store.getOrCreateUser(p.address);
      u.displayName = p.name;
      u.isAI = true;
      u.bio = p.bio;
      u.goonHandle = p.handle;
      if (p.avatarUrl) u.avatarUrl = p.avatarUrl;
      this.store.indexGoon(p.handle, p.address);
    }
    this.registered = true;
  }

  // ------------------------------------------------------------------ events

  /** A Pit moment was reported. Decide whether/who reacts. */
  onMoment(m: GoonMoment): void {
    if (!this.registered) this.register();
    const s = this.s;
    if (!s.enabled) return;
    // Update continuity memory first, so a reaction can reference it.
    if (m.kind === "winner" || m.kind === "upset") this.remember(m);

    // Players first: if a human just spoke here, only marquee beats may break in.
    const humanHot = this.humanRecentlyChatted(m.roomId, m.now);
    if (humanHot && !MARQUEE.has(m.kind)) return;
    // Global per-room cooldown.
    if (m.now - (this.lastAiAt.get(m.roomId) ?? 0) < s.chatCooldownSec * 1000) return;

    const category = CATEGORY[m.kind];
    const eligible = s.personas.filter(
      (p) => p.enabled && this.activeToday(p, m.now) && (p.pools[category]?.length ?? 0) > 0,
    );
    if (eligible.length === 0) return;

    // Event importance nudges the reaction chance up for the big beats.
    const weight = MARQUEE.has(m.kind) ? 1.35 : m.kind === "ambient" ? 0.7 : 1;
    // Human present: at most one line, and only reluctantly.
    const cap = humanHot ? 1 : s.maxPerEvent;

    // Roll each candidate (random order); named speak rarely, henchmen often.
    const order = [...eligible].sort(() => Math.random() - 0.5);
    let spoke = 0;
    for (const p of order) {
      if (spoke >= cap) break;
      const base = isNamed(p) ? s.namedChancePerEvent : s.henchmanChancePerEvent;
      const chance = Math.min(0.95, base * p.chattiness * weight * (humanHot ? 0.4 : 1));
      if (Math.random() > chance) continue;
      const line = this.pickLine(p, category);
      if (!line) continue;
      this.say(m.roomId, p, this.fillTokens(line, m, p), m.now);
      spoke++;
    }
    if (spoke > 0) this.lastAiAt.set(m.roomId, m.now);
  }

  /** Called every engine tick: ambient PIT_ROOM life + final-minute beats. */
  tick(now: number): void {
    const s = this.s;
    if (!s.enabled) return;

    // Any Pit rounds live/queued? If nobody's in The Pit, keep it silent.
    let anyPit = false;
    for (const r of this.store.rounds.values()) {
      if (r.matchType !== "pit") continue;
      if (r.state === "live") {
        anyPit = true;
        // Final-minute beat (once per round).
        if (r.endsAt && r.endsAt - now <= 60_000 && r.endsAt - now > 0 && !this.firedFinal.has(r.id)) {
          this.firedFinal.add(r.id);
          this.onMoment({ kind: "final_minute", roomId: r.id, symbol: r.token.symbol, now });
        }
      } else if (r.state === "lobby") {
        anyPit = true;
      }
    }
    // Ambient chatter in the general Pit room, paced + quiet-aware.
    if (anyPit && now - (this.lastAmbient.get(PIT_ROOM) ?? 0) >= s.ambientEverySec * 1000) {
      this.lastAmbient.set(PIT_ROOM, now);
      if (!this.humanRecentlyChatted(PIT_ROOM, now)) {
        this.onMoment({ kind: "ambient", roomId: PIT_ROOM, now });
      }
    }
    // Forget final-minute flags for rounds that are long gone.
    if (this.firedFinal.size > 200) this.firedFinal.clear();
  }

  // ------------------------------------------------------------------ helpers

  /** Whether a persona is "in" today (rotating presence keeps it unpredictable). */
  private activeToday(p: GoonPersona, now: number): boolean {
    switch (p.schedule) {
      case "always":
        return true;
      case "weekend": {
        const d = new Date(now).getUTCDay();
        return d === 0 || d === 6;
      }
      case "random":
        return hash01(`${dayKey(now)}:${p.handle}`) < 0.55;
      case "tournament":
      case "manual":
      default:
        return false;
    }
  }

  /** Weighted pick that avoids this persona's recently used lines. */
  private pickLine(p: GoonPersona, category: GoonDialogueCategory): string | null {
    const pool = p.pools[category];
    if (!pool || pool.length === 0) return null;
    const used = this.recent.get(p.handle) ?? [];
    const fresh = pool.filter((l) => !used.includes(l.text));
    const choices = fresh.length > 0 ? fresh : pool;
    const total = choices.reduce((sum, l) => sum + (l.weight ?? 1), 0);
    let x = Math.random() * total;
    let chosen = choices[0]!;
    for (const l of choices) if ((x -= l.weight ?? 1) < 0) { chosen = l; break; }
    const next = [...used, chosen.text].slice(-5);
    this.recent.set(p.handle, next);
    return chosen.text;
  }

  /** Fill {player}/{winner}/{symbol}/{rival}/{streak} from the event + memory. */
  private fillTokens(text: string, m: GoonMoment, p: GoonPersona): string {
    const winner = m.winner ?? m.player ?? "someone";
    const rivalName = this.rivalName(p);
    return text
      .replace(/\{player\}/g, m.player ?? "someone")
      .replace(/\{winner\}/g, winner)
      .replace(/\{symbol\}/g, m.symbol ? `$${m.symbol}` : "the coin")
      .replace(/\{rival\}/g, rivalName)
      .replace(/\{streak\}/g, String(this.store.goonMemory.streaks[winner] ?? 0));
  }

  private rivalName(p: GoonPersona): string {
    if (p.rivals.length === 0) return "someone";
    const handle = p.rivals[Math.floor(Math.random() * p.rivals.length)]!;
    return this.s.personas.find((x) => x.handle === handle)?.name ?? handle;
  }

  /** Post as the persona's account into a Pit room (never elsewhere). */
  private say(roomId: string, p: GoonPersona, text: string, now: number): void {
    // Hard guard: the Squad only ever speaks in Pit rooms.
    if (roomId !== PIT_ROOM && this.store.rounds.get(roomId)?.matchType !== "pit") return;
    const message: ChatMessage = {
      id: this.store.id(),
      roundId: roomId,
      userAddress: p.address,
      displayName: p.name,
      text,
      at: now,
    };
    let list = this.store.chat.get(roomId);
    if (!list) {
      list = [];
      this.store.chat.set(roomId, list);
    }
    list.push(message);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.broadcast(roomId, { type: "chat", message });
  }

  /** Did a real human post here within the players-first window? */
  private humanRecentlyChatted(roomId: string, now: number): boolean {
    const list = this.store.chat.get(roomId);
    if (!list) return false;
    const cutoff = now - this.s.humanQuietSec * 1000;
    for (let i = list.length - 1; i >= 0 && list[i]!.at >= cutoff; i--) {
      const a = (list[i]!.userAddress ?? "").toLowerCase();
      if (!a) continue;
      if (isGoon(a) || a.startsWith("0xb07")) continue; // AI/bots don't count
      if (!a.startsWith("0x")) continue; // system messages don't count
      return true;
    }
    return false;
  }

  /** Update continuity memory on a winner/upset. */
  private remember(m: GoonMoment): void {
    const name = m.winner ?? m.player;
    if (!name) return;
    const mem = this.store.goonMemory;
    mem.recentWinners.push({ name, at: m.now });
    const cutoff = m.now - this.s.memoryHours * 3_600_000;
    mem.recentWinners = mem.recentWinners.filter((w) => w.at >= cutoff).slice(-20);
    mem.streaks[name] = (mem.streaks[name] ?? 0) + 1;
    if (m.kind === "upset") mem.lastUpset = { name, at: m.now };
  }
}

/** A live Pit round the Goon engine cares about (typing helper for callers). */
export type PitRound = Round & { matchType: "pit" };
