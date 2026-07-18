"use client";

/**
 * Synthesized game sounds — Web Audio, no assets. One lazy AudioContext;
 * every effect is a couple of enveloped oscillators so the bundle stays flat.
 * Mute persists in localStorage ("cookout:muted").
 */

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function sfxMuted(): boolean {
  return typeof window !== "undefined" && localStorage.getItem("cookout:muted") === "1";
}
export function setSfxMuted(m: boolean): void {
  localStorage.setItem("cookout:muted", m ? "1" : "0");
}

function tone(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.12,
  glideTo?: number,
): void {
  const a = ac();
  if (!a || sfxMuted()) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Buy: quick rising major pluck. */
export function playBuy(): void {
  tone(523.25, 0, 0.1, "triangle", 0.14); // C5
  tone(659.25, 0.05, 0.14, "triangle", 0.12); // E5
}

/** Sell: soft falling minor pluck. */
export function playSell(): void {
  tone(493.88, 0, 0.1, "triangle", 0.14); // B4
  tone(392.0, 0.05, 0.16, "triangle", 0.12); // G4
}

/** Pull-up / arena deposit: warm harmonic chime (root + fifth + octave). */
export function playDeposit(): void {
  tone(392.0, 0, 0.5, "sine", 0.1); // G4
  tone(587.33, 0.04, 0.5, "sine", 0.08); // D5
  tone(783.99, 0.09, 0.6, "sine", 0.07); // G5
}

/** Someone else pulled up: a lighter single-note ping so a busy queue sings. */
export function playPullupPing(): void {
  tone(880, 0, 0.18, "sine", 0.05, 1174.66); // A5 → D6 glide
}

/** Achievement unlocked: sparkle arpeggio, console style. */
export function playAchievement(): void {
  tone(659.25, 0, 0.16, "triangle", 0.12); // E5
  tone(830.61, 0.09, 0.16, "triangle", 0.12); // G#5
  tone(987.77, 0.18, 0.2, "triangle", 0.12); // B5
  tone(1318.5, 0.27, 0.42, "sine", 0.12); // E6
}

/** Quest complete: two-note affirmative ding, softer than achievements. */
export function playQuest(): void {
  tone(587.33, 0, 0.14, "sine", 0.11); // D5
  tone(880.0, 0.1, 0.34, "sine", 0.1); // A5
}
