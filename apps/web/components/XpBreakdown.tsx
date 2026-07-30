"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { SectionTitle } from "./ProfileUI";

const META: Record<string, { label: string; icon: string; bar: string }> = {
  trading: { label: "Trading", icon: "📈", bar: "bg-lime-400" },
  quests: { label: "Daily quests", icon: "🎯", bar: "bg-sky-400" },
  challenges: { label: "Weekly challenges", icon: "🏅", bar: "bg-indigo-400" },
  achievements: { label: "Achievements", icon: "🏆", bar: "bg-amber-400" },
  streaks: { label: "Streaks", icon: "🔥", bar: "bg-orange-400" },
  milestones: { label: "Milestones", icon: "🚩", bar: "bg-emerald-400" },
  season: { label: "Season pass", icon: "🎟️", bar: "bg-pink-400" },
  pit: { label: "The Pit", icon: "🕳️", bar: "bg-fuchsia-400" },
  jackpot: { label: "Jackpot", icon: "💰", bar: "bg-yellow-400" },
  matches: { label: "Matches", icon: "🍳", bar: "bg-red-400" },
  other: { label: "Other", icon: "✨", bar: "bg-zinc-400" },
};

/** "Where your XP comes from": the lifetime XP-by-source breakdown, shown on the
 *  profile Quests tab. Sources are recorded server-side (store.addXp category). */
export function XpBreakdown({ address }: { address: string }) {
  const [bySource, setBySource] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    api<{ xpBySource?: Record<string, number> }>(`/api/profile/${address}`)
      .then((p) => setBySource(p.xpBySource ?? {}))
      .catch(() => setBySource({}));
  }, [address]);

  if (!bySource) return null;
  const rows = Object.entries(bySource)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);

  if (rows.length === 0)
    return (
      <div>
        <SectionTitle title="Where your XP comes from" />
        <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          Play a round, clear a quest, or enter The Pit to start earning XP.
        </div>
      </div>
    );

  return (
    <div>
      <SectionTitle
        title="Where your XP comes from"
        action={<span className="font-mono text-xs text-zinc-500">{total.toLocaleString()} XP total</span>}
      />
      <div className="space-y-2">
        {rows.map(([k, v]) => {
          const m = META[k] ?? META.other!;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <div key={k} className="rounded-2xl bg-zinc-900/40 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-sm">
                <span>{m.icon}</span>
                <span className="font-bold text-zinc-200">{m.label}</span>
                <span className="ml-auto font-mono font-black text-zinc-100">{v.toLocaleString()}</span>
                <span className="w-9 text-right font-mono text-xs text-zinc-500">{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
