"use client";

import type { KillFeedEvent } from "@cookout/shared";

const KILL_ICONS: Record<string, string> = {
  big_buy: "🟢",
  big_sell: "💥",
  whale_entered: "🐋",
  dev_buy: "👨‍🍳",
  dev_sell: "⚠️",
  rug_detected: "🔥",
  mcap_milestone: "🚀",
  new_leader: "👑",
  graduated: "🍽️",
};

/** Stock-ticker style kill-feed marquee that runs across the arena. */
export function KillFeedTicker({ killfeed }: { killfeed: KillFeedEvent[] }) {
  const items = killfeed.slice(-12);
  if (items.length === 0) return null;
  const row = (key: string) => (
    <div key={key} className="inline-flex items-center gap-8 pr-8">
      {items.map((e) => (
        <span key={`${key}-${e.id}`} className="inline-flex items-center gap-1.5 text-xs">
          <span>{KILL_ICONS[e.kind] ?? "•"}</span>
          <span className={e.kind === "rug_detected" ? "font-bold text-red-400" : "text-zinc-300"}>
            {e.kind === "rug_detected" ? `Burnt · ${e.text}` : e.text}
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/60 py-1.5">
      <div className="marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

/** Cheer reactions floating up over the arena. */
export function FloatingReactions({
  reactions,
}: {
  reactions: Array<{ id: number; emoji: string }>;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {reactions.map((r) => (
        <span key={r.id} className="float-emoji" style={{ left: `${8 + (r.id % 84)}%` }}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
