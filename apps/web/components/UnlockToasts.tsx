"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ACHIEVEMENTS, ACHIEVEMENT_XP } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { playAchievement, playQuest } from "../lib/sfx";

/**
 * Console-style unlock overlays (Xbox/PS vibes): achievements and completed
 * quests pop in at the top-right with a sound, linger, then fade. Clicking
 * one goes to the profile. Detection is client-side — we diff the profile's
 * achievement list and the mission board on a light poll, so it works with
 * zero new server events (baseline on first load: no replay of old unlocks).
 */

interface Toast {
  key: string;
  kind: "achievement" | "quest";
  title: string;
  sub: string;
  icon: string;
  accent: string; // border/text accent classes
  leaving?: boolean;
}

const RARITY_ACCENT: Record<string, string> = {
  common: "border-zinc-500 text-zinc-300",
  rare: "border-sky-400 text-sky-300",
  epic: "border-violet-400 text-violet-300",
  legendary: "border-amber-400 text-amber-300",
};

const LINGER_MS = 6000;
const FADE_MS = 700;

export function UnlockToasts() {
  const { profile } = useSession();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenAch = useRef<Set<string> | null>(null);
  const seenQuests = useRef<Set<string> | null>(null);

  const push = (t: Toast) => {
    setToasts((list) => [...list.slice(-3), t]);
    window.setTimeout(
      () => setToasts((list) => list.map((x) => (x.key === t.key ? { ...x, leaving: true } : x))),
      LINGER_MS,
    );
    window.setTimeout(
      () => setToasts((list) => list.filter((x) => x.key !== t.key)),
      LINGER_MS + FADE_MS,
    );
  };

  // Achievements: diff profile.achievements (session refreshes after trades).
  useEffect(() => {
    if (!profile) {
      seenAch.current = null;
      return;
    }
    const now = new Set(profile.achievements);
    if (seenAch.current === null) {
      seenAch.current = now; // baseline — never replay old unlocks
      return;
    }
    for (const id of now) {
      if (seenAch.current.has(id)) continue;
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (!def) continue;
      playAchievement();
      push({
        key: `ach-${id}-${Date.now()}`,
        kind: "achievement",
        title: `Achievement unlocked · ${def.name}`,
        sub: `${def.rarity} · ${def.description} · +${ACHIEVEMENT_XP[def.rarity]} XP`,
        icon: "🏆",
        accent: RARITY_ACCENT[def.rarity] ?? RARITY_ACCENT.common!,
      });
    }
    seenAch.current = now;
  }, [profile]);

  // Quests: poll the mission board and toast fresh completions.
  useEffect(() => {
    if (!profile) {
      seenQuests.current = null;
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const missions = await api<Array<{ id: string; name: string; xp: number; period: string; completed: boolean }>>(
          "/api/missions",
        );
        if (!alive) return;
        const done = new Set(missions.filter((m) => m.completed).map((m) => m.id));
        if (seenQuests.current === null) {
          seenQuests.current = done; // baseline
          return;
        }
        for (const m of missions) {
          if (!m.completed || seenQuests.current.has(m.id)) continue;
          playQuest();
          push({
            key: `quest-${m.id}-${Date.now()}`,
            kind: "quest",
            title: `Quest complete · ${m.name}`,
            sub: `${m.period === "daily" ? "daily quest" : "weekly challenge"} · +${m.xp} XP`,
            icon: "✅",
            accent: "border-lime-400 text-lime-300",
          });
        }
        seenQuests.current = done;
      } catch {
        /* transient — next poll */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [profile]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <Link
          key={t.key}
          href="/profile"
          className={`pointer-events-auto flex items-center gap-3 rounded-xl border-l-4 border border-zinc-800 bg-zinc-900/95 p-3 shadow-2xl shadow-black/60 backdrop-blur transition-all duration-700 ${
            t.leaving ? "translate-x-6 opacity-0" : "translate-x-0 opacity-100 animate-[fadein_.3s_ease]"
          } ${t.accent}`}
        >
          <span className="text-2xl">{t.icon}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-zinc-100">{t.title}</span>
            <span className={`block truncate text-xs ${t.accent.split(" ")[1]}`}>{t.sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
