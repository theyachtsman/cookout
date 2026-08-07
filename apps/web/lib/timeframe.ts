/**
 * Chart timeframe selection.
 *
 * Pure logic, kept out of the canvas component so it can be tested directly.
 */

export type TfSeconds = 1 | 15 | 60 | 300 | 900 | 3_600 | 14_400 | 86_400 | 604_800;
export type TfMode = "auto" | TfSeconds;

/**
 * The ladder, short to long.
 *
 * Timed modes never need more than a few minutes — a Blitz round is over in
 * one. Endurance has no clock at all: a coin can trade for days or weeks, and
 * on that horizon a 5-minute candle is noise. So the ladder runs all the way
 * out to a week, the way any real trading chart does.
 */
export const TIMEFRAMES: Array<[TfSeconds, string]> = [
  [1, "1s"],
  [15, "15s"],
  [60, "1m"],
  [300, "5m"],
  [900, "15m"],
  [3_600, "1h"],
  [14_400, "4h"],
  [86_400, "1D"],
  [604_800, "1W"],
];

/**
 * Timeframes worth offering for a round of this shape.
 *
 * A timed round can't fill an hourly candle, let alone a weekly one, so
 * offering them would just be nine buttons where seven do nothing.
 *
 * "Open-ended" is any market with no scheduled close, which is two things:
 * Endurance, and every coin that has bonded out — a graduated coin keeps
 * trading in the wild indefinitely, so its chart has exactly the same problem
 * a week-old Endurance coin does.
 */
export function timeframesFor(openEnded: boolean): Array<[TfSeconds, string]> {
  return openEnded ? TIMEFRAMES : TIMEFRAMES.filter(([s]) => s <= 300);
}

/**
 * Which stored series a timeframe should be built from.
 *
 * The server keeps a 1s tape (15 minutes), 1m rollups (24h) and 1h rollups
 * (30d). Aggregating up is exact; aggregating *down* is impossible, so each
 * timeframe reads the finest series that still covers it.
 */
export function sourceFor(tf: TfSeconds): "second" | "minute" | "hour" {
  if (tf < 60) return "second";
  if (tf < 3_600) return "minute";
  return "hour";
}

/**
 * Auto mode follows the shape of a round: every tick matters at the open, then
 * it zooms out as the match runs long and the story becomes the trend rather
 * than the tick. Manual selection always wins over this.
 *
 * An open-ended market keeps going past the point a timed round would have
 * ended, so it keeps stepping out — by the second day the useful view is
 * hours, not minutes.
 */
export function autoTf(phase?: string, liveAt?: number, openEnded = false): TfSeconds {
  if (!phase) return 1; // no round context (the landing demo): pure live feed
  if (phase !== "live" || !liveAt) return 15; // queue and results: readable
  const elapsed = (Date.now() - liveAt) / 1000;
  if (elapsed < 180) return 1; // the opening rush
  if (elapsed < 300) return 15;
  if (!openEnded) return 60;
  if (elapsed < 3_600) return 60; // first hour
  if (elapsed < 21_600) return 300; // out to six hours
  if (elapsed < 86_400) return 900; // first day
  if (elapsed < 604_800) return 3_600; // first week
  return 14_400;
}
