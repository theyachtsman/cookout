"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RARITY_MAP } from "@cookout/shared";
import { api } from "../../lib/api";

/**
 * Recruit NFT Goon — the entry point in the wallet slider.
 *
 * Deliberately just a doorway: it shows what the player has and what they can
 * afford, then sends them to /recruit. Buying and opening happen there, on a
 * page with room for the cinematic, rather than inside a 320px drawer.
 */

interface Feed {
  enabled: boolean;
  packs: { key: string; cost: number; crates: number }[];
  burgerBalance: number;
  progress: { percent: number; collected: number; total: number } | null;
  cards: { id: string; owned: boolean; rarity: string; name?: string; cardNumber: string; acquiredAt?: number }[];
}

export function RecruitPanel({ onNavigate }: { onNavigate?: () => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);

  useEffect(() => {
    api<Feed>("/api/collection")
      .then(setFeed)
      .catch(() => setFeed(null));
  }, []);

  if (!feed) return null;

  const cheapest = feed.packs.length ? Math.min(...feed.packs.map((p) => p.cost)) : 0;
  const canAfford = feed.burgerBalance >= cheapest;
  const recent = feed.cards
    .filter((c) => c.owned && c.acquiredAt)
    .sort((a, b) => (b.acquiredAt ?? 0) - (a.acquiredAt ?? 0))
    .slice(0, 6);

  return (
    <div className="space-y-2 px-4 pb-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
          Recruit NFT Goon
        </span>
        {feed.progress && (
          <span className="font-mono text-[10px] text-zinc-600">
            {feed.progress.collected}/{feed.progress.total} · {feed.progress.percent}%
          </span>
        )}
      </div>

      <Link
        href="/recruit"
        onClick={onNavigate}
        className="block overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/15 via-zinc-900/60 to-zinc-950 p-3 ring-1 ring-amber-400/25 transition hover:ring-amber-400/60"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">📦</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-zinc-100">
              {feed.enabled ? "Open Recruit Crates" : "Recruitment closed"}
            </div>
            <div className="text-[10px] leading-snug text-zinc-400">
              {!feed.enabled
                ? "Your roster is safe — check back soon."
                : canAfford
                  ? `Spend Burgers to recruit the Squad · from 🍔 ${cheapest}`
                  : `Earn 🍔 ${Math.ceil(cheapest - feed.burgerBalance)} more to open a crate`}
            </div>
          </div>
          <span className="shrink-0 text-zinc-600">→</span>
        </div>
      </Link>

      {recent.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
            Newest recruits
          </div>
          <div className="flex gap-1">
            {recent.map((c) => {
              const rarity = RARITY_MAP[c.rarity as keyof typeof RARITY_MAP];
              return (
                <div
                  key={c.id}
                  title={`${c.name ?? c.cardNumber} · ${rarity?.label ?? ""}`}
                  className="flex h-9 w-7 shrink-0 items-center justify-center rounded text-sm"
                  style={{
                    background: `${rarity?.color ?? "#52525b"}18`,
                    boxShadow: `inset 0 0 0 1px ${rarity?.color ?? "#52525b"}66`,
                  }}
                >
                  🔥
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
