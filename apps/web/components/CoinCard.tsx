"use client";

import type { RiskTier } from "@cookout/shared";
import { TierChip } from "./TierChip";

/**
 * The one coin card, used everywhere a coin is billboarded: the post-submit
 * preview, the vote page, and the match calendar.
 *
 * Anatomy: a wide banner fold up top (the creator's promo banner when they
 * uploaded one, otherwise the coin art blown up and blurred), the coin image
 * overlapping the fold, then name / $SYMBOL / tier / theme. Context-specific
 * content (vote buttons, countdowns, …) renders below via children; a corner
 * slot pins a chip over the fold (state label, vote count).
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
  const fold = coin.bannerUrl ?? coin.artworkUrl;
  const foldIsBanner = !!coin.bannerUrl;
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-zinc-900 ${borderClass} ${className}`}
    >
      {/* banner fold: creator banner, else the coin art blurred big */}
      <div className="relative h-24 w-full bg-gradient-to-r from-lime-400/15 via-zinc-900 to-zinc-900">
        {fold && (
          <div
            aria-hidden
            className={`absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110 ${
              teaser
                ? "scale-110 opacity-40 blur-2xl saturate-0"
                : foldIsBanner
                  ? ""
                  : "scale-110 opacity-60 blur-xl"
            }`}
            style={{ backgroundImage: `url(${fold})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/35 to-transparent" />
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
            <span className="truncate text-lg font-black text-zinc-50">
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
