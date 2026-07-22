"use client";

/**
 * The Cookout audio system.
 *
 * Not a pile of beeps — a manager. Every sound is a named event
 * (`audio.play("trade.buy")`) routed through a category, through a volume
 * group, through a master bus (soft limiter + synthesized plate reverb) to the
 * speakers. Categories have independent volume; a cooldown stops any one event
 * from machine-gunning; a priority + ducking pass lets a big moment push the
 * ambience and UI down and out of its way.
 *
 * It's built on synthesis (no audio assets → zero latency, flat bundle) but the
 * seam is the event registry: to swap a synth voice for a real sample later,
 * you re-register one event. Nothing in the app calls a sound directly; it all
 * goes through `audio.play(name)`.
 *
 * Sonic identity — every voice is one of four materials: Mechanical (clicks,
 * locks), Fire (ignition, whoosh), Electronic (clean synth UI), Impact (deep
 * cinematic bass). Never arcade, never casino, never meme.
 */

// ---------------------------------------------------------------------------
// Volume model
// ---------------------------------------------------------------------------

/** User-facing volume groups. Categories each belong to one of these. */
export type Group = "ui" | "gameplay" | "music";

export type Category =
  | "ui"
  | "trading"
  | "countdown"
  | "market"
  | "round"
  | "notify"
  | "chat"
  | "ambience"
  | "victory"
  | "failure"
  | "music";

const CATEGORY_GROUP: Record<Category, Group> = {
  ui: "ui",
  notify: "ui",
  chat: "ui",
  trading: "gameplay",
  countdown: "gameplay",
  market: "gameplay",
  round: "gameplay",
  ambience: "gameplay",
  victory: "gameplay",
  failure: "gameplay",
  music: "music",
};

interface Mix {
  master: number;
  ui: number;
  gameplay: number;
  music: number;
  muted: boolean;
}

const DEFAULT_MIX: Mix = { master: 0.9, ui: 0.8, gameplay: 1, music: 0.6, muted: false };
const MIX_KEY = "cookout:audio";
const LEGACY_MUTE_KEY = "cookout:muted";

function loadMix(): Mix {
  if (typeof window === "undefined") return { ...DEFAULT_MIX };
  try {
    const raw = localStorage.getItem(MIX_KEY);
    const legacyMuted = localStorage.getItem(LEGACY_MUTE_KEY) === "1";
    if (!raw) return { ...DEFAULT_MIX, muted: legacyMuted };
    return { ...DEFAULT_MIX, ...(JSON.parse(raw) as Partial<Mix>) };
  } catch {
    return { ...DEFAULT_MIX };
  }
}

// ---------------------------------------------------------------------------
// Event definition
// ---------------------------------------------------------------------------

/** Handed to each event so it can synthesize into its category and the reverb. */
interface RenderCtx {
  a: AudioContext;
  /** Category bus — connect voice outputs here. */
  out: GainNode;
  /** Reverb send — connect a parallel gain here for space. */
  reverb: GainNode;
  noise: AudioBuffer;
  t: number;
}

interface SoundEvent {
  category: Category;
  /** Higher wins when two sounds collide inside the same cooldown window. */
  priority?: number;
  /** Minimum ms between plays of this exact event; drops spam. */
  cooldownMs?: number;
  /** Duck ambience + UI under this event for its moment. */
  duck?: boolean;
  render: (c: RenderCtx) => void;
}

// ---------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------

class AudioManager {
  private ctx: AudioContext | null = null;
  private comp!: DynamicsCompressorNode;
  private masterGain!: GainNode;
  private groups!: Record<Group, GainNode>;
  private cats!: Record<Category, GainNode>;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private mix: Mix = loadMix();
  private lastAt = new Map<string, number>();
  private registry = new Map<string, SoundEvent>();
  private ambienceStop: (() => void) | null = null;
  private ambienceName: string | null = null;
  private duckUntil = 0;

  // ---- lifecycle ----

  /** Lazily builds the graph on first sound (after a user gesture). */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const a = new AC();
    this.ctx = a;

    // limiter → destination
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 26;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    comp.connect(a.destination);
    this.comp = comp;

    // master → limiter
    const master = a.createGain();
    master.connect(comp);
    this.masterGain = master;

    // groups → master
    this.groups = {
      ui: a.createGain(),
      gameplay: a.createGain(),
      music: a.createGain(),
    };
    for (const g of Object.values(this.groups)) g.connect(master);

    // categories → their group
    this.cats = {} as Record<Category, GainNode>;
    for (const cat of Object.keys(CATEGORY_GROUP) as Category[]) {
      const node = a.createGain();
      node.connect(this.groups[CATEGORY_GROUP[cat]]);
      this.cats[cat] = node;
    }

    // synthesized plate reverb, parallel into the limiter
    this.reverbSend = a.createGain();
    this.reverbSend.gain.value = 1;
    const seconds = 1.1;
    const len = Math.floor(a.sampleRate * seconds);
    const impulse = a.createBuffer(2, len, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.6) * (x < 0.02 ? x / 0.02 : 1);
      }
    }
    const conv = a.createConvolver();
    conv.buffer = impulse;
    const wet = a.createGain();
    wet.gain.value = 0.5;
    this.reverbSend.connect(conv).connect(wet).connect(comp);

    // a second of noise for transients/risers
    const nlen = a.sampleRate;
    this.noise = a.createBuffer(1, nlen, a.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.applyMix();
    return a;
  }

  private applyMix(): void {
    if (!this.ctx) return;
    const m = this.mix.muted ? 0 : 1;
    this.masterGain.gain.value = this.mix.master * m;
    this.groups.ui.gain.value = this.mix.ui;
    this.groups.gameplay.gain.value = this.mix.gameplay;
    this.groups.music.gain.value = this.mix.music;
  }

  // ---- public mix controls ----

  getMix(): Mix {
    return { ...this.mix };
  }
  setVolume(which: keyof Omit<Mix, "muted">, value: number): void {
    this.mix[which] = Math.min(1, Math.max(0, value));
    this.persist();
    this.applyMix();
  }
  setMuted(muted: boolean): void {
    this.mix.muted = muted;
    this.persist();
    this.applyMix();
  }
  toggleMuted(): boolean {
    this.setMuted(!this.mix.muted);
    return this.mix.muted;
  }
  isMuted(): boolean {
    return this.mix.muted;
  }
  private persist(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(MIX_KEY, JSON.stringify(this.mix));
    localStorage.setItem(LEGACY_MUTE_KEY, this.mix.muted ? "1" : "0");
  }

  // ---- registration & playback ----

  register(name: string, def: SoundEvent): void {
    this.registry.set(name, def);
  }

  /**
   * Play a single struck-mallet note into a category. For parametric melodies
   * (the pull-up riff) whose pitch isn't known ahead of registration.
   */
  playNote(category: Category, freq: number, downbeat = false): void {
    if (this.mix.muted) return;
    const a = this.ensure();
    if (!a) return;
    const c: RenderCtx = { a, out: this.cats[category], reverb: this.reverbSend, noise: this.noise, t: a.currentTime };
    fm(c, freq, { dur: 0.28, gain: 0.1, ratio: 2, index: 90, send: 0.22 });
    if (downbeat) sub(c, 96, { dur: 0.12, gain: 0.11 });
  }

  /** Fire a named event. Silently no-ops if muted, unknown, or on cooldown. */
  play(name: string): void {
    if (this.mix.muted) return;
    const def = this.registry.get(name);
    if (!def) return;
    const a = this.ensure();
    if (!a) return;

    const now = a.currentTime * 1000;
    const cd = def.cooldownMs ?? 40; // a floor so nothing double-triggers
    const last = this.lastAt.get(name) ?? -Infinity;
    if (now - last < cd) return;
    this.lastAt.set(name, now);

    if (def.duck) this.duck();

    def.render({
      a,
      out: this.cats[def.category],
      reverb: this.reverbSend,
      noise: this.noise,
      t: a.currentTime,
    });
  }

  /**
   * Duck ambience and UI under a hero moment, then bring them smoothly back.
   * Gameplay event sounds themselves are not ducked — they're the point.
   */
  duck(ms = 650): void {
    if (!this.ctx) return;
    const a = this.ctx;
    this.duckUntil = Math.max(this.duckUntil, a.currentTime + ms / 1000);
    const amb = this.cats.ambience.gain;
    const ui = this.groups.ui.gain;
    for (const [node, floor, restore] of [
      [amb, 0.15, 1],
      [ui, 0.4, this.mix.ui],
    ] as const) {
      node.cancelScheduledValues(a.currentTime);
      node.setValueAtTime(node.value, a.currentTime);
      node.linearRampToValueAtTime(floor, a.currentTime + 0.05);
      node.setValueAtTime(floor, this.duckUntil);
      node.linearRampToValueAtTime(restore, this.duckUntil + 0.25);
    }
  }

  // ---- ambience loops ----

  /** Start a looping ambience bed (idempotent per name). Very subtle by design. */
  startAmbience(name: "lobby" | "live"): void {
    if (this.ambienceName === name) return;
    this.stopAmbience();
    const a = this.ensure();
    if (!a) return;
    this.ambienceName = name;
    this.ambienceStop = buildAmbience(a, this.cats.ambience, this.noise, name);
  }
  stopAmbience(): void {
    this.ambienceStop?.();
    this.ambienceStop = null;
    this.ambienceName = null;
  }
}

// ---------------------------------------------------------------------------
// Synthesis primitives (operate on a RenderCtx)
// ---------------------------------------------------------------------------

/**
 * Soft-clip curve for saturation. Pushing a signal through this (via a drive
 * pre-gain) adds harmonic grit and glue — the single biggest thing that stops
 * a synth voice sounding like a bare beep. Cached; one curve serves every voice.
 */
let SAT_CURVE: Float32Array<ArrayBuffer> | null = null;
function satCurve(): Float32Array<ArrayBuffer> {
  if (SAT_CURVE) return SAT_CURVE;
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 2.2);
  }
  SAT_CURVE = c;
  return c;
}

interface VoiceOpts {
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  glideTo?: number;
  /** How long the pitch glide takes (s). Short = a punchy percussive drop. */
  pitchDur?: number;
  cutoff?: number;
  cutoffTo?: number;
  q?: number;
  detune?: number;
  send?: number;
  attack?: number;
  /** Saturation drive (0 = clean). ~2–3 warms, ~5–8 bites. */
  drive?: number;
}

/** Filtered, enveloped oscillator (optionally detuned/stacked/saturated). */
function voice(c: RenderCtx, freq: number, o: VoiceOpts = {}): void {
  const { a, out, reverb } = c;
  const {
    at = 0, dur = 0.2, type = "triangle", gain = 0.12, glideTo, pitchDur,
    cutoff = 3200, cutoffTo, q = 0.9, detune = 0, send = 0, attack = 0.006, drive = 0,
  } = o;
  const t = c.t + at;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, t);
  if (cutoffTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoffTo), t + dur);
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const d of detune ? [-detune, detune] : [0]) {
    const osc = a.createOscillator();
    osc.type = type;
    osc.detune.value = d;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + (pitchDur ?? dur));
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  // filter → [drive → saturate] → gain → out
  let head: AudioNode = filter;
  if (drive > 0) {
    const pre = a.createGain();
    pre.gain.value = drive;
    const ws = a.createWaveShaper();
    ws.curve = satCurve();
    ws.oversample = "2x";
    filter.connect(pre).connect(ws);
    head = ws;
  }
  head.connect(g).connect(out);
  if (send > 0) {
    const s = a.createGain();
    s.gain.value = send;
    g.connect(s).connect(reverb);
  }
}

/** FM voice — a modulator bends the carrier: mallet/bell/marimba timbres. */
function fm(
  c: RenderCtx,
  freq: number,
  o: { at?: number; dur?: number; gain?: number; ratio?: number; index?: number; send?: number } = {},
): void {
  const { a, out, reverb } = c;
  const { at = 0, dur = 0.4, gain = 0.12, ratio = 2, index = 220, send = 0.18 } = o;
  const t = c.t + at;
  const carrier = a.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const mod = a.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * ratio;
  const modGain = a.createGain();
  modGain.gain.setValueAtTime(index, t);
  modGain.gain.exponentialRampToValueAtTime(1, t + dur * 0.7);
  mod.connect(modGain).connect(carrier.frequency);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  carrier.connect(g).connect(out);
  if (send > 0) {
    const s = a.createGain();
    s.gain.value = send;
    g.connect(s).connect(reverb);
  }
  mod.start(t);
  carrier.start(t);
  mod.stop(t + dur + 0.05);
  carrier.stop(t + dur + 0.05);
}

/** Filtered noise burst — the transient click/whoosh/crash body. */
function noiseBurst(
  c: RenderCtx,
  o: { at?: number; dur?: number; gain?: number; type?: BiquadFilterType; cutoff?: number; cutoffTo?: number; q?: number; send?: number } = {},
): void {
  const { a, out, reverb, noise } = c;
  const { at = 0, dur = 0.08, gain = 0.12, type = "bandpass", cutoff = 2000, cutoffTo, q = 0.7, send = 0 } = o;
  const t = c.t + at;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, t);
  if (cutoffTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoffTo), t + dur);
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(out);
  if (send > 0) {
    const s = a.createGain();
    s.gain.value = send;
    g.connect(s).connect(reverb);
  }
  src.start(t);
  src.stop(t + dur + 0.02);
}

/**
 * Sub-bass thump you feel. The pitch drop is what gives it punch — it snaps
 * down fast (dropDur) while the amplitude rings out longer (dur), the same
 * envelope trick a kick drum uses. A touch of saturation adds body on speakers
 * too small to reproduce the fundamental.
 */
function sub(
  c: RenderCtx,
  freq: number,
  o: { at?: number; dur?: number; gain?: number; drop?: number; dropDur?: number; drive?: number } = {},
): void {
  const { a, out } = c;
  const { at = 0, dur = 0.22, gain = 0.16, drop = freq * 0.5, dropDur, drive = 1.4 } = o;
  const t = c.t + at;
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(28, drop), t + (dropDur ?? dur * 0.4));
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let head: AudioNode = osc;
  if (drive > 1) {
    const pre = a.createGain();
    pre.gain.value = drive;
    const ws = a.createWaveShaper();
    ws.curve = satCurve();
    osc.connect(pre).connect(ws);
    head = ws;
  }
  head.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/**
 * A tactile click — the tight noise transient + micro pitched tick that makes
 * a UI action feel mechanical and satisfying rather than like a tone. `bright`
 * shifts it up for confirms/buys, down for cancels/sells.
 */
function click(c: RenderCtx, o: { at?: number; gain?: number; bright?: number; body?: number } = {}): void {
  const { at = 0, gain = 1, bright = 1, body = 1 } = o;
  // The snap: very short filtered noise, the "tick".
  noiseBurst(c, { at, dur: 0.018, gain: 0.09 * gain, type: "highpass", cutoff: 2600 * bright });
  // A micro tonal body with a fast downward pitch drop = the "chunk".
  voice(c, 420 * bright, {
    at,
    dur: 0.05 * body,
    type: "square",
    gain: 0.07 * gain,
    glideTo: 240 * bright,
    pitchDur: 0.03,
    cutoff: 2200 * bright,
    drive: 3,
  });
}

// ---------------------------------------------------------------------------
// Ambience beds
// ---------------------------------------------------------------------------

function buildAmbience(a: AudioContext, out: GainNode, noise: AudioBuffer, name: "lobby" | "live"): () => void {
  const stopped = { v: false };
  // A quiet filtered-noise wash: lobby = warm/wind, live = tense/electronic.
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = name === "lobby" ? "lowpass" : "bandpass";
  filter.frequency.value = name === "lobby" ? 380 : 240;
  filter.Q.value = name === "lobby" ? 0.6 : 1.4;
  const bed = a.createGain();
  bed.gain.value = 0;
  bed.gain.linearRampToValueAtTime(name === "lobby" ? 0.02 : 0.03, a.currentTime + 2);
  src.connect(filter).connect(bed).connect(out);
  src.start();

  // A slow LFO on the cutoff so the bed breathes instead of sitting static.
  const lfo = a.createOscillator();
  lfo.frequency.value = name === "lobby" ? 0.07 : 0.15;
  const lfoGain = a.createGain();
  lfoGain.gain.value = name === "lobby" ? 90 : 140;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  return () => {
    if (stopped.v) return;
    stopped.v = true;
    bed.gain.cancelScheduledValues(a.currentTime);
    bed.gain.setValueAtTime(bed.gain.value, a.currentTime);
    bed.gain.linearRampToValueAtTime(0, a.currentTime + 1.2);
    setTimeout(() => {
      try {
        src.stop();
        lfo.stop();
      } catch {
        /* already stopped */
      }
    }, 1400);
  };
}

// ---------------------------------------------------------------------------
// The manager singleton + event registry
// ---------------------------------------------------------------------------

export const audio = new AudioManager();

function register(): void {
  const R = (name: string, def: SoundEvent) => audio.register(name, def);

  // ---------------- UI (Mechanical / Electronic) ----------------
  R("ui.hover", {
    category: "ui",
    cooldownMs: 30,
    render: (c) => voice(c, 2200, { dur: 0.03, type: "sine", gain: 0.03, cutoff: 6000 }),
  });
  R("ui.click", {
    category: "ui",
    cooldownMs: 40,
    render: (c) => {
      noiseBurst(c, { dur: 0.02, gain: 0.05, type: "bandpass", cutoff: 2400, q: 1.4 });
      voice(c, 320, { dur: 0.04, type: "square", gain: 0.05, cutoff: 1400 });
    },
  });
  R("ui.confirm", {
    category: "ui",
    render: (c) => {
      noiseBurst(c, { dur: 0.025, gain: 0.05, type: "highpass", cutoff: 2600 });
      voice(c, 440, { dur: 0.12, type: "triangle", gain: 0.1, glideTo: 560, cutoff: 1800, cutoffTo: 4000, send: 0.15 });
      sub(c, 150, { dur: 0.08, gain: 0.07 });
    },
  });
  R("ui.cancel", {
    category: "ui",
    render: (c) => voice(c, 300, { dur: 0.1, type: "triangle", gain: 0.08, glideTo: 180, cutoff: 1200 }),
  });
  R("ui.tab", {
    category: "ui",
    cooldownMs: 60,
    render: (c) => noiseBurst(c, { dur: 0.12, gain: 0.045, type: "bandpass", cutoff: 900, cutoffTo: 2600, q: 0.6, send: 0.1 }),
  });
  R("ui.modalOpen", {
    category: "ui",
    render: (c) => {
      noiseBurst(c, { dur: 0.18, gain: 0.05, type: "bandpass", cutoff: 500, cutoffTo: 3200, q: 0.5, send: 0.15 });
      voice(c, 520, { dur: 0.14, type: "sine", gain: 0.05, glideTo: 700, send: 0.15 });
    },
  });
  R("ui.modalClose", {
    category: "ui",
    render: (c) => noiseBurst(c, { dur: 0.16, gain: 0.045, type: "bandpass", cutoff: 3200, cutoffTo: 500, q: 0.5, send: 0.1 }),
  });
  R("ui.walletConnect", {
    category: "ui",
    render: (c) => {
      // A secure locking click — two mechanical taps into a warm confirm.
      noiseBurst(c, { dur: 0.03, gain: 0.06, type: "bandpass", cutoff: 1800, q: 2 });
      noiseBurst(c, { at: 0.07, dur: 0.03, gain: 0.06, type: "bandpass", cutoff: 2200, q: 2 });
      fm(c, 587.33, { at: 0.1, dur: 0.4, gain: 0.09, ratio: 2, index: 90, send: 0.3 });
      sub(c, 120, { at: 0.1, dur: 0.14, gain: 0.08 });
    },
  });

  // ---------------- Trading (Mechanical + Electronic) ----------------
  // Buy: a tactile confirm — a crisp click over a saturated "vwip" that snaps
  // upward, with a sub tap for weight. Reads as an action, not a note.
  R("trade.buy", {
    category: "trading",
    cooldownMs: 45,
    render: (c) => {
      click(c, { gain: 1, bright: 1.15 });
      voice(c, 300, { dur: 0.11, type: "sawtooth", gain: 0.1, glideTo: 470, pitchDur: 0.08, cutoff: 900, cutoffTo: 3600, q: 1.2, drive: 4, send: 0.08 });
      sub(c, 150, { dur: 0.11, gain: 0.11, drop: 90, dropDur: 0.05 });
    },
  });
  // Sell: same gesture, darker filter, pitch snapping down.
  R("trade.sell", {
    category: "trading",
    cooldownMs: 45,
    render: (c) => {
      click(c, { gain: 0.9, bright: 0.8 });
      voice(c, 360, { dur: 0.13, type: "sawtooth", gain: 0.1, glideTo: 185, pitchDur: 0.09, cutoff: 2700, cutoffTo: 650, q: 1.2, drive: 4, send: 0.08 });
      sub(c, 140, { dur: 0.12, gain: 0.1, drop: 80, dropDur: 0.06 });
    },
  });
  // Other players' fills — tiny crisp ticks. Frequent, so short and quiet.
  R("trade.tickBuy", {
    category: "trading",
    cooldownMs: 25,
    render: (c) => {
      noiseBurst(c, { dur: 0.018, gain: 0.03, type: "highpass", cutoff: 3800 });
      voice(c, 900, { dur: 0.04, type: "square", gain: 0.04, glideTo: 1180, pitchDur: 0.03, cutoff: 5200, drive: 2 });
    },
  });
  R("trade.tickSell", {
    category: "trading",
    cooldownMs: 25,
    render: (c) => {
      noiseBurst(c, { dur: 0.018, gain: 0.025, type: "bandpass", cutoff: 1300, q: 1.4 });
      voice(c, 520, { dur: 0.05, type: "square", gain: 0.04, glideTo: 330, pitchDur: 0.035, cutoff: 1800, drive: 2 });
    },
  });
  R("trade.deposit", {
    category: "trading",
    render: (c) => {
      fm(c, 392.0, { dur: 0.6, gain: 0.11, ratio: 2, index: 120, send: 0.3 });
      fm(c, 587.33, { at: 0.05, dur: 0.6, gain: 0.09, ratio: 2, index: 120, send: 0.3 });
      fm(c, 783.99, { at: 0.1, dur: 0.7, gain: 0.08, ratio: 3, index: 90, send: 0.35 });
      sub(c, 98, { dur: 0.18, gain: 0.1 });
    },
  });

  // ---------------- Market events (Impact) ----------------
  // Whale buy: a deep punchy hit that rises into saturated power. It should
  // land in your chest and grab attention.
  R("market.whaleBuy", {
    category: "market",
    priority: 5,
    duck: true,
    cooldownMs: 300,
    render: (c) => {
      sub(c, 95, { dur: 0.8, gain: 0.26, drop: 45, dropDur: 0.08, drive: 2 });
      voice(c, 180, { at: 0.01, dur: 0.55, type: "sawtooth", gain: 0.1, glideTo: 520, pitchDur: 0.4, cutoff: 300, cutoffTo: 2900, q: 2.2, detune: 12, drive: 5, send: 0.3 });
      noiseBurst(c, { dur: 0.45, gain: 0.06, type: "bandpass", cutoff: 200, cutoffTo: 4200, q: 0.5, send: 0.4 }); // rising air
    },
  });
  // Whale sell: heavy and dark — a distorted metallic fall. Danger.
  R("market.whaleSell", {
    category: "market",
    priority: 5,
    duck: true,
    cooldownMs: 300,
    render: (c) => {
      sub(c, 100, { dur: 0.75, gain: 0.26, drop: 36, dropDur: 0.1, drive: 2 });
      voice(c, 220, { at: 0.01, dur: 0.6, type: "sawtooth", gain: 0.1, glideTo: 70, pitchDur: 0.5, cutoff: 1400, cutoffTo: 220, q: 3, detune: 14, drive: 5, send: 0.35 });
      noiseBurst(c, { dur: 0.3, gain: 0.06, type: "lowpass", cutoff: 800, cutoffTo: 140 });
    },
  });
  R("market.milestone", {
    category: "market",
    priority: 3,
    cooldownMs: 200,
    render: (c) => {
      sub(c, 120, { dur: 0.12, gain: 0.08, drop: 80, dropDur: 0.05 }); // a tap so it lands
      fm(c, 523.25, { dur: 0.16, gain: 0.1, ratio: 2, index: 130, send: 0.28 });
      fm(c, 659.25, { at: 0.07, dur: 0.16, gain: 0.1, ratio: 2, index: 130, send: 0.28 });
      fm(c, 783.99, { at: 0.14, dur: 0.16, gain: 0.1, ratio: 2, index: 130, send: 0.28 });
      fm(c, 1046.5, { at: 0.21, dur: 0.45, gain: 0.11, ratio: 2, index: 120, send: 0.4 });
    },
  });
  R("market.ath", {
    category: "market",
    cooldownMs: 400,
    render: (c) => {
      fm(c, 1568, { dur: 0.2, gain: 0.07, ratio: 3, index: 80, send: 0.4 });
      fm(c, 2093, { at: 0.08, dur: 0.24, gain: 0.06, ratio: 3, index: 80, send: 0.45 });
      fm(c, 2637, { at: 0.16, dur: 0.4, gain: 0.05, ratio: 3, index: 70, send: 0.5 });
      noiseBurst(c, { dur: 0.35, gain: 0.02, type: "highpass", cutoff: 6000, cutoffTo: 13000, send: 0.4 });
    },
  });

  // ---------------- Countdown (Impact, escalating) ----------------
  for (const n of [5, 4, 3, 2, 1] as const) {
    // Each tick is a punchy percussive impact; pitch and bite climb toward COOK.
    const climb = (6 - n) / 5; // 0.2 → 1.0
    R(`countdown.${n}`, {
      category: "countdown",
      priority: 6,
      duck: n === 1,
      render: (c) => {
        sub(c, 80 + climb * 45, { dur: 0.14, gain: 0.15 + climb * 0.07, drop: 50, dropDur: 0.05, drive: 2 });
        noiseBurst(c, { dur: 0.03 + climb * 0.02, gain: 0.06 + climb * 0.05, type: "bandpass", cutoff: 900 + climb * 1300, q: 1.4 });
        voice(c, 220 + climb * 180, { dur: 0.09, type: "square", gain: 0.06 + climb * 0.05, glideTo: 140 + climb * 120, pitchDur: 0.05, cutoff: 1600 + climb * 2200, drive: 3 });
      },
    });
  }
  R("countdown.cook", {
    category: "countdown",
    priority: 10,
    duck: true,
    render: (c) => {
      // The defining moment: a massive saturated impact + air rush + bright lift.
      sub(c, 65, { dur: 0.95, gain: 0.3, drop: 42, dropDur: 0.12, drive: 2.2 });
      noiseBurst(c, { dur: 0.6, gain: 0.11, type: "bandpass", cutoff: 250, cutoffTo: 8000, q: 0.5, send: 0.5 }); // air rush up
      voice(c, 180, { dur: 0.55, type: "sawtooth", gain: 0.11, glideTo: 900, pitchDur: 0.4, cutoff: 500, cutoffTo: 4500, q: 2, detune: 14, drive: 5, send: 0.4 });
      fm(c, 523.25, { at: 0.06, dur: 0.7, gain: 0.1, ratio: 2, index: 150, send: 0.45 }); // bright stab
    },
  });
  R("round.launch", {
    // Auction settlement / doors open — the sporting-event kickoff.
    category: "round",
    priority: 9,
    duck: true,
    render: (c) => {
      sub(c, 58, { dur: 0.85, gain: 0.27, drop: 40, dropDur: 0.1, drive: 2 });
      noiseBurst(c, { dur: 0.5, gain: 0.1, type: "bandpass", cutoff: 350, cutoffTo: 7000, q: 0.6, send: 0.45 });
      voice(c, 220, { at: 0.02, dur: 0.5, type: "sawtooth", gain: 0.09, glideTo: 560, pitchDur: 0.35, cutoff: 600, cutoffTo: 3800, q: 1.6, detune: 12, drive: 4, send: 0.35 });
    },
  });

  // ---------------- Round events: Victory / Failure ----------------
  R("round.graduated", {
    category: "victory",
    priority: 8,
    duck: true,
    render: (c) => {
      // Deep impact → saturated brass rise → metallic shimmer → crowd swell.
      sub(c, 62, { dur: 0.55, gain: 0.17, drop: 46, dropDur: 0.1, drive: 2 });
      voice(c, 523.25, { dur: 0.75, type: "sawtooth", gain: 0.08, cutoff: 900, cutoffTo: 3200, q: 1.4, detune: 12, attack: 0.04, drive: 4, send: 0.35 });
      voice(c, 659.25, { dur: 0.75, type: "sawtooth", gain: 0.07, cutoff: 900, cutoffTo: 3200, q: 1.4, detune: 12, attack: 0.05, drive: 4, send: 0.35 });
      voice(c, 783.99, { dur: 0.8, type: "sawtooth", gain: 0.07, cutoff: 900, cutoffTo: 3400, q: 1.4, detune: 12, attack: 0.05, drive: 4, send: 0.35 });
      fm(c, 1046.5, { at: 0.28, dur: 0.7, gain: 0.11, ratio: 3, index: 130, send: 0.5 }); // metallic shimmer
      noiseBurst(c, { at: 0.1, dur: 0.5, gain: 0.05, type: "bandpass", cutoff: 400, cutoffTo: 5500, q: 0.6, send: 0.5 }); // crowd swell
    },
  });
  R("round.rug", {
    category: "failure",
    priority: 8,
    duck: true,
    render: (c) => {
      // Silence handled by the caller. Bass drop → crack → extinguish → dark fall.
      sub(c, 100, { dur: 0.55, gain: 0.22, drop: 32, dropDur: 0.12, drive: 2.5 });
      noiseBurst(c, { at: 0.05, dur: 0.035, gain: 0.13, type: "bandpass", cutoff: 2400, q: 3 }); // wood crack
      noiseBurst(c, { at: 0.13, dur: 0.5, gain: 0.08, type: "lowpass", cutoff: 1600, cutoffTo: 180, send: 0.4 }); // extinguish hiss
      voice(c, 300, { at: 0.09, dur: 0.75, type: "sawtooth", gain: 0.08, glideTo: 60, pitchDur: 0.6, cutoff: 1400, cutoffTo: 200, q: 5, detune: 14, drive: 5, send: 0.4 }); // dark fall
    },
  });
  R("round.over", {
    category: "round",
    priority: 6,
    render: (c) => {
      sub(c, 110, { dur: 0.3, gain: 0.14, drop: 55, dropDur: 0.08 });
      voice(c, 300, { dur: 0.4, type: "triangle", gain: 0.08, glideTo: 210, pitchDur: 0.3, cutoff: 1400, drive: 2, send: 0.2 });
    },
  });

  // ---------------- Leaderboard (subtle) ----------------
  R("leaderboard.firstPlace", {
    category: "notify",
    priority: 4,
    cooldownMs: 500,
    render: (c) => {
      // A small achievement sting — a brass stab into a bell.
      voice(c, 392, { dur: 0.16, type: "sawtooth", gain: 0.07, cutoff: 900, cutoffTo: 2400, q: 2.5, detune: 12, attack: 0.03, send: 0.2 });
      fm(c, 659.25, { at: 0.12, dur: 0.35, gain: 0.09, ratio: 2, index: 120, send: 0.3 });
    },
  });
  R("leaderboard.lostFirst", {
    category: "notify",
    priority: 3,
    cooldownMs: 500,
    render: (c) => {
      sub(c, 120, { dur: 0.22, gain: 0.12, drop: 60 });
      voice(c, 300, { dur: 0.16, type: "triangle", gain: 0.06, glideTo: 200, cutoff: 1000 });
    },
  });

  // ---------------- Jackpot (prestige, never a slot machine) ----------------
  R("jackpot", {
    category: "victory",
    priority: 10,
    duck: true,
    render: (c) => {
      sub(c, 55, { dur: 0.7, gain: 0.24, drop: 41 }); // deep cinematic hit
      // Orchestral rise.
      voice(c, 392, { dur: 1.0, type: "sawtooth", gain: 0.07, glideTo: 784, cutoff: 700, cutoffTo: 3600, q: 1.3, detune: 12, attack: 0.08, send: 0.4 });
      voice(c, 523, { at: 0.05, dur: 1.0, type: "sawtooth", gain: 0.06, glideTo: 1046, cutoff: 800, cutoffTo: 3800, q: 1.3, detune: 12, attack: 0.09, send: 0.4 });
      // Firework shimmer cascade.
      fm(c, 1568, { at: 0.5, dur: 0.5, gain: 0.06, ratio: 3, index: 90, send: 0.5 });
      fm(c, 2093, { at: 0.62, dur: 0.5, gain: 0.05, ratio: 3, index: 90, send: 0.55 });
      fm(c, 2637, { at: 0.74, dur: 0.6, gain: 0.05, ratio: 3, index: 80, send: 0.6 });
    },
  });

  // ---------------- Notifications & achievements ----------------
  R("notify.achievement", {
    category: "notify",
    priority: 4,
    render: (c) => {
      fm(c, 659.25, { dur: 0.24, gain: 0.11, ratio: 2, index: 140, send: 0.3 });
      fm(c, 830.61, { at: 0.1, dur: 0.24, gain: 0.11, ratio: 2, index: 140, send: 0.3 });
      fm(c, 987.77, { at: 0.2, dur: 0.28, gain: 0.11, ratio: 2, index: 140, send: 0.3 });
      fm(c, 1318.5, { at: 0.3, dur: 0.55, gain: 0.12, ratio: 3, index: 120, send: 0.4 });
      noiseBurst(c, { at: 0.3, dur: 0.4, gain: 0.025, type: "highpass", cutoff: 5000, cutoffTo: 11000, send: 0.3 });
    },
  });
  R("notify.quest", {
    category: "notify",
    priority: 3,
    render: (c) => {
      fm(c, 587.33, { dur: 0.22, gain: 0.1, ratio: 2, index: 90, send: 0.25 });
      fm(c, 880.0, { at: 0.11, dur: 0.42, gain: 0.1, ratio: 2, index: 90, send: 0.3 });
    },
  });
  R("notify.xp", {
    category: "notify",
    priority: 2,
    render: (c) => voice(c, 660, { dur: 0.14, type: "triangle", gain: 0.07, glideTo: 990, cutoff: 4000, send: 0.2 }),
  });

  // ---------------- Chat (Mechanical / radio) ----------------
  R("chat.mention", {
    category: "chat",
    cooldownMs: 300,
    render: (c) => {
      voice(c, 880, { dur: 0.08, type: "sine", gain: 0.07, cutoff: 5000, send: 0.2 });
      voice(c, 1320, { at: 0.06, dur: 0.14, type: "sine", gain: 0.06, send: 0.25 });
    },
  });
  R("chat.system", {
    category: "chat",
    cooldownMs: 300,
    render: (c) => noiseBurst(c, { dur: 0.06, gain: 0.04, type: "bandpass", cutoff: 1800, q: 3, send: 0.15 }), // radio chirp
  });
  R("chat.announce", {
    category: "chat",
    cooldownMs: 400,
    render: (c) => {
      noiseBurst(c, { dur: 0.05, gain: 0.045, type: "bandpass", cutoff: 1400, q: 2.5 });
      voice(c, 700, { at: 0.04, dur: 0.16, type: "triangle", gain: 0.06, glideTo: 900, send: 0.2 });
    },
  });
}

register();
