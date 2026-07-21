"use client";

import { useEffect, useRef, useState } from "react";
import type { KillFeedEvent, KillFeedKind } from "@cookout/shared";

/**
 * Two halves of the same idea: a persistent event strip that runs in every
 * phase, and the big callouts that punch through when something actually
 * matters. Both read the round's kill feed, so they stay honest.
 */

const KIND: Record<KillFeedKind, { icon: string; cls: string; loud?: boolean }> = {
  big_buy: { icon: "🟢", cls: "text-emerald-300" },
  big_sell: { icon: "🔴", cls: "text-red-300" },
  whale_entered: { icon: "🐋", cls: "text-amber-300", loud: true },
  dev_buy: { icon: "👨‍🍳", cls: "text-lime-300" },
  dev_sell: { icon: "⚠️", cls: "text-orange-300", loud: true },
  rug_detected: { icon: "💀", cls: "text-red-400", loud: true },
  mcap_milestone: { icon: "🚀", cls: "text-lime-300", loud: true },
  new_leader: { icon: "👑", cls: "text-amber-300", loud: true },
  graduated: { icon: "🍽️", cls: "text-lime-300", loud: true },
};

const stamp = (at: number, from?: number) => {
  if (!from) return "";
  const s = Math.max(0, Math.floor((at - from) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** The always-on strip: last events, newest on the left, scrolls sideways. */
export function EventStrip({
  killfeed,
  since,
  live,
}: {
  killfeed: KillFeedEvent[];
  /** Round start, so events get a match clock instead of wall time. */
  since?: number;
  live?: boolean;
}) {
  const recent = [...killfeed].slice(-14).reverse();
  return (
    <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-zinc-500">
        Event feed
        {live && (
          <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-black text-red-300">
            LIVE
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 gap-4 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recent.length === 0 && <span className="text-zinc-600">nothing yet</span>}
        {recent.map((e) => {
          const k = KIND[e.kind];
          return (
            <span key={e.id} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              {since && <span className="font-mono text-[10px] text-zinc-600">{stamp(e.at, since)}</span>}
              <span>{k.icon}</span>
              <span className={k.cls}>{e.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Callouts: the loud stuff gets a card that slides in over the chart's top
 * corner and leaves on its own. Quiet events never interrupt.
 */
export function Callouts({ killfeed }: { killfeed: KillFeedEvent[] }) {
  const [shown, setShown] = useState<KillFeedEvent[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    // Baseline on first render so loading a mid-round page doesn't replay.
    if (seen.current === null) {
      seen.current = new Set(killfeed.map((e) => e.id));
      return;
    }
    const fresh = killfeed.filter((e) => !seen.current!.has(e.id) && KIND[e.kind]?.loud);
    for (const e of killfeed) seen.current.add(e.id);
    if (fresh.length === 0) return;
    setShown((cur) => [...cur, ...fresh].slice(-3));
    for (const e of fresh) {
      setTimeout(() => setShown((cur) => cur.filter((x) => x.id !== e.id)), 4200);
    }
  }, [killfeed]);

  if (shown.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30 flex w-64 flex-col gap-2">
      {shown.map((e) => {
        const k = KIND[e.kind];
        return (
          <div
            key={e.id}
            className="animate-[fadein_.25s_ease] rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{k.icon}</span>
              <span className={`text-xs font-black leading-tight ${k.cls}`}>{e.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Phase transition: a short full-bleed announcement over the chart when the
 * round changes gear. Fires once per transition, then gets out of the way.
 */
export function PhaseFlash({ text, tone }: { text: string; tone: "go" | "end" | "bad" }) {
  const cls =
    tone === "go"
      ? "text-emerald-300 border-emerald-400/50"
      : tone === "bad"
        ? "text-red-300 border-red-500/50"
        : "text-lime-300 border-lime-400/50";
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div
        className={`animate-[fadein_.3s_ease] rounded-2xl border-2 bg-zinc-950/80 px-8 py-4 text-3xl font-black tracking-tight backdrop-blur md:text-5xl ${cls}`}
      >
        {text}
      </div>
    </div>
  );
}
