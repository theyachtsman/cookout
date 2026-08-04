"use client";

import { useEffect, useRef, useState } from "react";
import type { KillFeedActor, KillFeedEvent } from "@cookout/shared";
import { ActorFace } from "./ActorFace";

/**
 * Structural callouts that live on the chart's edges instead of on top of it.
 *
 * Per-trade buys and sells are drawn straight onto the chart now as the
 * trader's profile-pic dot, so these edge callouts are reserved for the market
 * structure moments: a new leader up top, a whale entering on the left, and
 * milestones / graduations / rugs / dev sells along the bottom. Nothing ever
 * covers price action, nothing sits on the right edge (that's the price axis),
 * and each one leaves on its own.
 */

type Edge = "left" | "top" | "bottom";

interface Callout {
  id: string;
  edge: Edge;
  icon: string;
  text: string;
  cls: string;
  at: number;
  /** Set on developer events, so the callout shows their face and name. */
  actor?: KillFeedActor;
}

const LIFETIME_MS = 3000;
/** Per edge, so a busy tape can't push a stack off the chart. */
const MAX_PER_EDGE = 3;

const EDGE_CLS: Record<Edge, string> = {
  left: "left-2 top-1/2 -translate-y-1/2 items-start",
  top: "left-1/2 top-2 -translate-x-1/2 items-center",
  bottom: "left-1/2 bottom-2 -translate-x-1/2 items-center",
};

/** Killfeed kinds that earn an edge callout, and where each one goes. Nothing
 *  maps to the right edge — that side of the chart stays clear for the axis. */
const FEED_EDGE: Record<string, { edge: Edge; icon: string; cls: string }> = {
  new_leader: { edge: "top", icon: "👑", cls: "border-amber-400/60 text-amber-200" },
  whale_entered: { edge: "left", icon: "🐋", cls: "border-amber-400/60 text-amber-200" },
  mcap_milestone: { edge: "bottom", icon: "🔥", cls: "border-lime-400/60 text-lime-200" },
  graduated: { edge: "bottom", icon: "🎓", cls: "border-lime-400/60 text-lime-200" },
  rug_detected: { edge: "bottom", icon: "💀", cls: "border-red-500/60 text-red-200" },
  dev_sell: { edge: "bottom", icon: "⚠️", cls: "border-orange-400/60 text-orange-200" },
};

export function EdgeCallouts({ killfeed }: { killfeed: KillFeedEvent[] }) {
  const [shown, setShown] = useState<Callout[]>([]);
  const seenFeed = useRef<Set<string> | null>(null);

  const push = (c: Callout) =>
    setShown((cur) => {
      const sameEdge = cur.filter((x) => x.edge === c.edge);
      const trimmed =
        sameEdge.length >= MAX_PER_EDGE
          ? cur.filter((x) => x.id !== sameEdge[0]!.id)
          : cur;
      return [...trimmed, c];
    });

  // Structural events → top / left / bottom.
  useEffect(() => {
    if (seenFeed.current === null) {
      seenFeed.current = new Set(killfeed.map((e) => e.id));
      return;
    }
    for (const e of killfeed) {
      if (seenFeed.current.has(e.id)) continue;
      seenFeed.current.add(e.id);
      const meta = FEED_EDGE[e.kind];
      if (!meta) continue;
      push({
        id: e.id,
        edge: meta.edge,
        icon: meta.icon,
        text: e.text,
        cls: meta.cls,
        at: Date.now(),
        actor: e.actor,
      });
    }
  }, [killfeed]);

  // One sweeper for everything, rather than a timer per callout.
  useEffect(() => {
    if (shown.length === 0) return;
    const t = setInterval(
      () => setShown((cur) => cur.filter((c) => Date.now() - c.at < LIFETIME_MS)),
      250,
    );
    return () => clearInterval(t);
  }, [shown.length]);

  if (shown.length === 0) return null;

  return (
    <>
      {(Object.keys(EDGE_CLS) as Edge[]).map((edge) => {
        const items = shown.filter((c) => c.edge === edge);
        if (items.length === 0) return null;
        return (
          <div
            key={edge}
            className={`pointer-events-none absolute z-20 flex flex-col gap-1.5 ${EDGE_CLS[edge]}`}
          >
            {items.map((c) => (
              <div
                key={c.id}
                className={`animate-[calloutIn_.28s_cubic-bezier(.2,1.4,.4,1)] whitespace-nowrap rounded-lg border bg-zinc-950/85 px-2.5 py-1 text-[11px] font-bold shadow-lg shadow-black/50 backdrop-blur ${c.cls}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>{c.icon}</span>
                  {/* Dev sells name the dev right on the chart edge. */}
                  {c.actor && <ActorFace actor={c.actor} size={16} ring="ring-orange-400/70" />}
                  <span>{c.text}</span>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
