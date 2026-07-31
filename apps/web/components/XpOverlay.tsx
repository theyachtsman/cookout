"use client";

import { useEffect, useRef, useState } from "react";
import { onXp, type XpGain } from "../lib/xpBus";
import { playXp } from "../lib/sfx";

interface Toast extends XpGain {
  id: number;
  levelUp: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  trading: "Trading",
  quests: "Quest",
  challenges: "Challenge",
  achievements: "Achievement",
  streaks: "Streak",
  milestones: "Milestone",
  season: "Season",
  pit: "The Pit",
  jackpot: "Jackpot",
  other: "",
};

/**
 * The global +XP drop-in: whenever XP lands (server pushes an "xp" socket event
 * to just this player), a satisfying amount pops in with a chime. Stacks briefly,
 * then floats away. Mounted once in the root layout.
 */
export function XpOverlay() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevLevel = useRef<number | null>(null);

  // Subscribe once; the level ref survives re-renders so the listener is stable.
  useEffect(() => {
    let seq = 0;
    return onXp((e) => {
      const levelUp = prevLevel.current !== null && e.level > prevLevel.current;
      prevLevel.current = e.level;
      const t: Toast = { ...e, id: ++seq, levelUp };
      setToasts((prev) => [...prev.slice(-4), t]);
      playXp();
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 1900);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[90] flex flex-col items-center gap-2">
      {toasts.map((t) => {
        const label = t.source ? SOURCE_LABEL[t.source] ?? "" : "";
        return (
          <div
            key={t.id}
            className="animate-xpdrop flex items-center gap-2 rounded-full bg-zinc-950/90 px-4 py-2 shadow-xl ring-1 ring-lime-400/40 backdrop-blur"
          >
            {t.levelUp ? (
              <span className="text-sm font-black text-amber-300">⬆ Level {t.level}!</span>
            ) : null}
            <span className="font-mono text-lg font-black text-lime-300">+{t.amount} XP</span>
            {label && <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>}
          </div>
        );
      })}
    </div>
  );
}
