import { marketCap, type Round } from "@cookout/shared";

/**
 * Ordering for the active Endurance rail.
 *
 * Pure, and kept out of the page so it can be tested directly — the same
 * reason timeframe.ts exists.
 *
 * Endurance runs indefinitely, which is what makes this necessary at all: a
 * timed rail can order by start time because everything on it is minutes old,
 * but an Endurance coin can be a week into trading. After the first day,
 * launch order stops describing anything a player cares about.
 */
export type EndSort = "hot" | "recent" | "mcap";

export const END_SORTS: ReadonlyArray<readonly [EndSort, string]> = [
  ["hot", "🔥 Hot"],
  ["recent", "Recent"],
  ["mcap", "Market cap"],
] as const;

/** When a coin started trading, falling back to when it was scheduled. */
function startedAt(r: Round): number {
  return r.liveAt ?? r.scheduledAt;
}

/**
 * Sort a copy of the rail.
 *
 * "Hot" is the default and the point of the shelf: a coin launched last week
 * that is being traded right now belongs in front of one launched this morning
 * that nobody has touched. Coins nobody has traded have no heat to rank by, so
 * they fall in behind the traded ones rather than sorting to the top on a
 * missing timestamp — newest first among themselves.
 */
export function sortEndurance(rounds: readonly Round[], sort: EndSort): Round[] {
  const list = [...rounds];
  if (sort === "mcap") {
    return list.sort((a, b) => (b.pool ? marketCap(b.pool) : 0) - (a.pool ? marketCap(a.pool) : 0));
  }
  if (sort === "recent") return list.sort((a, b) => startedAt(b) - startedAt(a));
  return list.sort((a, b) => {
    const ta = a.lastTradeAt ?? 0;
    const tb = b.lastTradeAt ?? 0;
    if (ta !== tb) return tb - ta;
    return startedAt(b) - startedAt(a);
  });
}
