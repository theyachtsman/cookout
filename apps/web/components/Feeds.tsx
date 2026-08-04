"use client";

import type { KillFeedEvent, Trade } from "@cookout/shared";
import { ActorFace } from "./arena/ActorFace";

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
export function Feeds({
  killfeed,
  trades,
  unit = "pETH",
}: {
  killfeed: KillFeedEvent[];
  trades: Trade[];
  unit?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 p-4">
        <h4 className="mb-2 text-sm font-bold text-zinc-300">Kill Feed</h4>
        <div className="flex h-40 flex-col-reverse gap-1 overflow-y-auto">
          {[...killfeed].reverse().map((e) => (
            <div
              key={e.id}
              className={`killfeed-item flex items-center gap-1.5 rounded px-2 py-1 text-sm ${
                e.kind === "dev_sell" ? "bg-orange-500/[0.12]" : "bg-zinc-900"
              }`}
            >
              <span>{KILL_ICONS[e.kind] ?? "•"}</span>
              {/* Developer trades show the dev's picture beside the line. */}
              {e.actor && (
                <ActorFace
                  actor={e.actor}
                  size={16}
                  ring={e.kind === "dev_buy" ? "ring-lime-400/70" : "ring-orange-400/70"}
                />
              )}
              {e.kind === "rug_detected" ? (
                <span className="font-bold text-red-400">Burnt · {e.text}</span>
              ) : e.kind === "dev_sell" ? (
                <span className="font-bold text-orange-300">{e.text}</span>
              ) : (
                <span>{e.text}</span>
              )}
            </div>
          ))}
          {killfeed.length === 0 && <div className="text-xs text-zinc-600">quiet so far…</div>}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 p-4">
        <h4 className="mb-2 text-sm font-bold text-zinc-300">Live Activity</h4>
        <div className="flex h-40 flex-col-reverse gap-1 overflow-y-auto font-mono text-xs">
          {[...trades].reverse().map((t) => (
            <div key={t.id} className="flex justify-between rounded bg-zinc-900 px-2 py-1">
              <span className={t.side === "buy" ? "text-emerald-400" : "text-red-400"}>
                {t.isCreator
                  ? `${t.displayName ?? "Dev"} (dev)`
                  : (t.displayName ?? `${t.userAddress.slice(0, 6)}…${t.userAddress.slice(-4)}`)}{" "}
                {t.side === "buy" ? "bought" : "sold"}
              </span>
              <span>{t.ethAmount.toFixed(3)} {unit}</span>
            </div>
          ))}
          {trades.length === 0 && <div className="text-xs text-zinc-600">no trades yet</div>}
        </div>
      </div>
    </div>
  );
}
