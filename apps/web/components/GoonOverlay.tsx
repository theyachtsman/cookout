"use client";

import { useCallback, useState } from "react";
import type { GoonOverlayEvent } from "@cookout/shared";

/**
 * Cinematic Flame Goon Squad moment banners ("🔥 GHOST ENTERED THE PIT"). Fed by
 * the `goon_overlay` socket event on the Pit pages. Sparse by design — the
 * backend gates how often these fire. Rarity tints the banner.
 */
export function useGoonOverlays() {
  const [overlays, setOverlays] = useState<GoonOverlayEvent[]>([]);
  const push = useCallback((o: GoonOverlayEvent) => {
    setOverlays((prev) => [...prev.slice(-2), o]);
    setTimeout(() => setOverlays((prev) => prev.filter((x) => x.id !== o.id)), 3800);
  }, []);
  return { overlays, push };
}

const RARITY: Record<string, string> = {
  legendary: "from-amber-500/30 ring-amber-400/60 text-amber-100",
  epic: "from-lime-500/25 ring-lime-400/50 text-lime-100",
  elite: "from-sky-500/25 ring-sky-400/50 text-sky-100",
  henchman: "from-zinc-600/25 ring-white/20 text-zinc-100",
};

export function GoonOverlayLayer({ overlays }: { overlays: GoonOverlayEvent[] }) {
  if (overlays.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-[85] flex flex-col items-center gap-2 px-4">
      {overlays.map((o) => (
        <div
          key={o.id}
          className={`animate-goonslam flex items-center gap-3 rounded-xl bg-gradient-to-r to-zinc-950/90 px-5 py-3 shadow-2xl ring-1 backdrop-blur ${
            RARITY[o.rarity] ?? RARITY.henchman
          }`}
        >
          <span className="text-base font-black uppercase tracking-wide sm:text-lg">{o.text}</span>
        </div>
      ))}
    </div>
  );
}
