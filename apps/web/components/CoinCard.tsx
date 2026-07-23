"use client";

import type { TokenConcept } from "@cookout/shared";
import { TierChip } from "./TierChip";

/**
 * The promo card for a coin: wide banner as the backdrop, coin art overlapping
 * the fold, name / $SYMBOL / tier / theme underneath. Used as the post-submit
 * preview and anywhere a coin deserves a billboard.
 */
export function CoinCard({ concept }: { concept: TokenConcept }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
      {/* banner fold */}
      <div className="relative h-28 w-full bg-gradient-to-r from-lime-400/15 via-zinc-900 to-zinc-900">
        {concept.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concept.bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/30 to-transparent" />
      </div>

      {/* identity row overlapping the fold */}
      <div className="relative -mt-9 flex items-end gap-3 px-4 pb-4">
        {concept.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={concept.artworkUrl}
            alt={concept.name}
            className="h-16 w-16 shrink-0 rounded-xl border-2 border-zinc-950 bg-zinc-800 object-cover shadow-lg"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-950 bg-zinc-800 text-2xl shadow-lg">
            🪙
          </div>
        )}
        <div className="min-w-0 flex-1 pb-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-black text-zinc-50">{concept.name}</span>
            <span className="font-mono text-sm text-zinc-500">${concept.symbol}</span>
            <TierChip tier={concept.tier} />
          </div>
          <div className="truncate text-xs text-zinc-400">{concept.theme}</div>
        </div>
      </div>
    </div>
  );
}
