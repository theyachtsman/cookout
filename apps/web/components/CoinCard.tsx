"use client";

import type { RiskTier } from "@cookout/shared";
import { TierChip } from "./TierChip";

/**
 * The one coin card, used everywhere a coin is billboarded: the post-submit
 * preview, the vote page, and the match calendar.
 *
 * Anatomy: a wide banner fold up top, the coin image overlapping the fold,
 * then name / $SYMBOL / tier / theme, with context content below (children)
 * and a chip slot pinned over the fold (corner).
 *
 * Backdrops — chosen so there is never a visible seam between fold and body:
 *  - creator banner uploaded → banner in the fold, fading into the body color;
 *  - coin art only → the art blown up and blurred across the WHOLE card,
 *    dimmed toward the bottom for readability;
 *  - nothing → a soft lime wash fading into the body.
 */

export interface CoinIdentity {
  name: string;
  symbol: string;
  theme: string;
  artworkUrl?: string;
  bannerUrl?: string;
  tier?: RiskTier;
}

export function CoinCard({
  coin,
  corner,
  children,
  teaser = false,
  borderClass = "border-zinc-700",
  className = "",
}: {
  coin: CoinIdentity;
  /** Element pinned top-right over the banner (state chip, vote count…). */
  corner?: React.ReactNode;
  /** Context body rendered below the identity row. */
  children?: React.ReactNode;
  /** Pre-reveal (scheduled rounds): hide identity, blur & desaturate art. */
  teaser?: boolean;
  borderClass?: string;
  className?: string;
}) {
  const fullBlur = !coin.bannerUrl && !!coin.artworkUrl;
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-zinc-950 ${borderClass} ${className}`}
    >
      {/* Full-card backdrop for banner-less coins: art blurred edge to edge.
          One smooth two-stop dim — a mid gradient stop reads as a seam. */}
      {fullBlur && (
        <>
          <div
            aria-hidden
            className={`absolute inset-0 scale-110 bg-cover bg-center transition-transform duration-700 group-hover:scale-125 ${
              teaser ? "opacity-30 blur-2xl saturate-0" : "opacity-60 blur-lg"
            }`}
            style={{ backgroundImage: `url(${coin.artworkUrl})` }}
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-zinc-950/35 to-zinc-950/85"
          />
        </>
      )}

      {/* fold: the designed banner (or a soft wash when there's no media) */}
      <div className="relative h-24 w-full">
        {coin.bannerUrl ? (
          <>
            <div
              aria-hidden
              className={`absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110 ${
                teaser ? "scale-110 opacity-40 blur-2xl saturate-0" : ""
              }`}
              style={{ backgroundImage: `url(${coin.bannerUrl})` }}
            />
            {/* fades into the exact body color — no seam */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/25 to-transparent"
            />
          </>
        ) : !fullBlur ? (
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-lime-400/10 to-transparent"
          />
        ) : null}
        {corner && <div className="absolute right-3 top-3">{corner}</div>}
      </div>

      {/* identity row overlapping the fold */}
      <div className="relative -mt-9 flex items-end gap-3 px-4 pb-3">
        {coin.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coin.artworkUrl}
            alt={teaser ? "" : coin.name}
            className={`h-16 w-16 shrink-0 rounded-xl border-2 border-zinc-950 bg-zinc-800 object-cover shadow-lg ${
              teaser ? "blur-md saturate-0" : ""
            }`}
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-950 bg-zinc-800 text-2xl shadow-lg">
            {teaser ? "❓" : "🪙"}
          </div>
        )}
        <div className="min-w-0 flex-1 pb-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-black text-zinc-50 drop-shadow">
              {teaser ? "???" : coin.name}
            </span>
            {!teaser && <span className="font-mono text-sm text-zinc-500">${coin.symbol}</span>}
            <TierChip tier={coin.tier} />
          </div>
          <div className="truncate text-xs text-zinc-400">
            {teaser ? `Theme: ${coin.theme}` : coin.theme}
          </div>
        </div>
      </div>

      {children && <div className="relative px-4 pb-4">{children}</div>}
    </div>
  );
}
