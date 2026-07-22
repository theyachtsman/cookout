"use client";

/**
 * Compatibility shim over the audio system (lib/audio.ts).
 *
 * Every sound now lives as a named event in the central AudioManager; this file
 * keeps the old `play*` names working so existing call sites don't move. New
 * code should prefer `audio.play("category.event")` directly.
 */

import { audio } from "./audio";

export function sfxMuted(): boolean {
  return audio.isMuted();
}
export function setSfxMuted(m: boolean): void {
  audio.setMuted(m);
}

export const playBuy = () => audio.play("trade.buy");
export const playSell = () => audio.play("trade.sell");
export const playDeposit = () => audio.play("trade.deposit");
export const playAchievement = () => audio.play("notify.achievement");
export const playQuest = () => audio.play("notify.quest");
export const playWhale = () => audio.play("market.whaleBuy");
export const playThud = () => audio.play("market.whaleSell");
export const playRug = () => audio.play("round.rug");
export const playMilestone = () => audio.play("market.milestone");
export const playHorn = () => audio.play("leaderboard.firstPlace");
export const playAthSparkle = () => audio.play("market.ath");
export const playFanfare = () => audio.play("round.graduated");

/** Distant fill ticks — buys bright, sells dark; size still scales level. */
export function playTradeTick(side: "buy" | "sell", _eth: number): void {
  void _eth;
  audio.play(side === "buy" ? "trade.tickBuy" : "trade.tickSell");
}

/**
 * Pull-up riff: every deposit landing on the queue board plays the next note
 * of a pentatonic groove, so a filling lobby literally builds a song. The
 * melody is deterministic on the bid index so every spectator hears the same
 * thing. Rendered here (rather than as a static event) because the pitch is a
 * function of the index.
 */
const RIFF = [
  392.0, 440.0, 523.25, 587.33, 659.25, 587.33, 523.25, 659.25, 783.99, 659.25,
  587.33, 523.25, 440.0, 523.25, 587.33, 783.99,
];
export function playPullupNote(index: number): void {
  const step = ((index % RIFF.length) + RIFF.length) % RIFF.length;
  const octaveUp = Math.floor(index / RIFF.length) % 2 === 1;
  const freq = RIFF[step]! * (octaveUp ? 2 : 1);
  audio.playNote("trading", freq, step % 4 === 0);
}
