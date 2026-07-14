"use client";

import type { KillFeedEvent, Trade } from "@cookout/shared";

const KILL_ICONS: Record<string, string> = {
  big_buy: "🟢",
  big_sell: "💥",
  whale_entered: "🐋",
  dev_buy: "👨‍🍳",
  dev_sell: "⚠️",
  rug_detected: "🔥",
  mcap_milestone: "🚀",
  new_leader: "👑",
  graduated: "🎓",
};

/** Kill feed + live activity feed. "Burnt" is flavor; data stays rug_detected. */
export function Feeds({ killfeed, trades }: { killfeed: KillFeedEvent[]; trades: Trade[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 p-4">
        <h4 className="mb-2 text-sm font-bold text-zinc-300">Kill Feed</h4>
        <div className="flex max-h-44 flex-col-reverse gap-1 overflow-y-auto">
          {[...killfeed].reverse().map((e) => (
            <div key={e.id} className="killfeed-item rounded bg-zinc-900 px-2 py-1 text-sm">
              <span className="mr-1.5">{KILL_ICONS[e.kind] ?? "•"}</span>
              {e.kind === "rug_detected" ? (
                <span className="font-bold text-red-400">Burnt — {e.text}</span>
              ) : (
                e.text
              )}
            </div>
          ))}
          {killfeed.length === 0 && <div className="text-xs text-zinc-600">quiet so far…</div>}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 p-4">
        <h4 className="mb-2 text-sm font-bold text-zinc-300">Live Activity</h4>
        <div className="flex max-h-44 flex-col-reverse gap-1 overflow-y-auto font-mono text-xs">
          {[...trades].reverse().map((t) => (
            <div key={t.id} className="flex justify-between rounded bg-zinc-900 px-2 py-1">
              <span className={t.side === "buy" ? "text-emerald-400" : "text-red-400"}>
                {t.isCreator ? "Developer" : `${t.userAddress.slice(0, 6)}…${t.userAddress.slice(-4)}`}{" "}
                {t.side === "buy" ? "bought" : "sold"}
              </span>
              <span>{t.ethAmount.toFixed(3)} pETH</span>
            </div>
          ))}
          {trades.length === 0 && <div className="text-xs text-zinc-600">no trades yet</div>}
        </div>
      </div>
    </div>
  );
}
