/**
 * Chart timeframe selection.
 *
 * Pure logic, kept out of the canvas component so it can be tested directly.
 */

export type TfMode = "auto" | 1 | 15 | 60 | 300;

export const TIMEFRAMES: Array<[Exclude<TfMode, "auto">, string]> = [
  [1, "1s"],
  [15, "15s"],
  [60, "1m"],
  [300, "5m"],
];

/**
 * Auto mode follows the shape of a round: every tick matters at the open, then
 * it zooms out as the match runs long and the story becomes the trend rather
 * than the tick. Manual selection always wins over this.
 */
export function autoTf(phase?: string, liveAt?: number): 1 | 15 | 60 {
  if (!phase) return 1; // no round context (the landing demo): pure live feed
  if (phase !== "live" || !liveAt) return 15; // queue and results: readable
  const elapsed = (Date.now() - liveAt) / 1000;
  if (elapsed < 180) return 1; // the opening rush
  if (elapsed < 300) return 15;
  return 60;
}
