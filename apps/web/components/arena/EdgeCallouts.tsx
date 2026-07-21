"use client";

import { useEffect, useRef, useState } from "react";
import type { KillFeedEvent, Trade } from "@cookout/shared";

/**
 * Trade callouts that live on the chart's edges instead of on top of it.
 *
 * The old bubbles pinned to the exact time+price of a trade, which meant the
 * most interesting moments — the ones with the most trades — were the moments
 * you could least see the candles. These anchor to the frame instead: buys on
 * the left, sells on the right, standings up top, market structure below.
 * Nothing ever covers price action, and each one leaves on its own.
 */

type Edge = "left" | "right" | "top" | "bottom";

interface Callout {
  id: string;
  edge: Edge;
  icon: string;
  text: string;
  cls: string;
  at: number;
}

const LIFETIME_MS = 3000;
/** Per edge, so a busy tape can't push a stack off the chart. */
const MAX_PER_EDGE = 3;

const EDGE_CLS: Record<Edge, string> = {
  left: "left-2 top-1/2 -translate-y-1/2 items-start",
  right: "right-2 top-1/2 -translate-y-1/2 items-end",
  top: "left-1/2 top-2 -translate-x-1/2 items-center",
  bottom: "left-1/2 bottom-2 -translate-x-1/2 items-center",
};

/** Killfeed kinds that earn an edge callout, and where each one goes. */
const FEED_EDGE: Record<string, { edge: Edge; icon: string; cls: string }> = {
  new_leader: { edge: "top", icon: "👑", cls: "border-amber-400/60 text-amber-200" },
  whale_entered: { edge: "left", icon: "🐋", cls: "border-amber-400/60 text-amber-200" },
  mcap_milestone: { edge: "bottom", icon: "🔥", cls: "border-lime-400/60 text-lime-200" },
  graduated: { edge: "bottom", icon: "🎓", cls: "border-lime-400/60 text-lime-200" },
  rug_detected: { edge: "bottom", icon: "💀", cls: "border-red-500/60 text-red-200" },
  dev_sell: { edge: "right", icon: "⚠️", cls: "border-orange-400/60 text-orange-200" },
};

export function EdgeCallouts({
  trades,
  killfeed,
  bigTradeEth,
  nameFor,
}: {
  trades: Trade[];
  killfeed: KillFeedEvent[];
  /** Only trades at or above this size are worth interrupting for. */
  bigTradeEth: number;
  nameFor?: (address: string) => string;
}) {
  const [shown, setShown] = useState<Callout[]>([]);
  const seenTrades = useRef<Set<string> | null>(null);
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

  // Big trades → left (buys) / right (sells).
  useEffect(() => {
    const key = (t: Trade) => `${t.userAddress}-${t.at}`;
    if (seenTrades.current === null) {
      // Baseline on mount so opening a live round mid-match doesn't replay.
      seenTrades.current = new Set(trades.map(key));
      return;
    }
    for (const t of trades) {
      const k = key(t);
      if (seenTrades.current.has(k)) continue;
      seenTrades.current.add(k);
      if (t.ethAmount < bigTradeEth && !t.isCreator) continue;
      const buy = t.side === "buy";
      const who = t.isCreator ? "Developer" : (nameFor?.(t.userAddress) ?? short(t.userAddress));
      push({
        id: `${k}-${Math.random()}`,
        edge: buy ? "left" : "right",
        icon: buy ? "🟢" : "🔴",
        text: `${who} ${buy ? "bought" : "sold"} ${t.ethAmount.toFixed(2)}`,
        cls: buy ? "border-emerald-400/60 text-emerald-200" : "border-red-500/60 text-red-200",
        at: Date.now(),
      });
    }
  }, [trades, bigTradeEth, nameFor]);

  // Structural events → top / bottom.
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
      push({ id: e.id, edge: meta.edge, icon: meta.icon, text: e.text, cls: meta.cls, at: Date.now() });
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
                <span className="mr-1">{c.icon}</span>
                {c.text}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-2)}`;
