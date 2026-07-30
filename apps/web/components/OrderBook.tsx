"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "@cookout/shared";

/**
 * The live order book — a DexScreener-style trade tape that sits under the
 * buy/sell buttons and stays put after a coin graduates or burns out (it just
 * renders the round's trade history, which the server keeps).
 *
 * Personalized: every row is a known account (display name + avatar, clickable
 * through to their profile) instead of a raw address, with the creator flagged
 * as DEV and the biggest clips wearing a 🐋. Filter by buys/sells, watch the
 * buy-vs-sell pressure bar, and see the freshest trade flash in.
 */

type Filter = "all" | "buy" | "sell";

const money = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
      ? `$${(v / 1_000).toFixed(1)}k`
      : v >= 1
        ? `$${v.toFixed(2)}`
        : `$${v.toFixed(3)}`;

const tokens = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : v.toFixed(0);

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function OrderBook({
  trades,
  symbol,
  ethUsd,
  me,
}: {
  trades: Trade[];
  symbol: string;
  ethUsd: number;
  /** The viewer's address, so their own trades get a "you" tag + highlight. */
  me?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  // A ticking clock keeps the relative ages honest without new data.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Whale line: the fattest clips (top of the pack) wear a 🐋.
  const whaleEth = useMemo(() => {
    const max = trades.reduce((m, t) => Math.max(m, t.ethAmount), 0);
    return max * 0.6;
  }, [trades]);

  // Buy/sell pressure across the whole tape, by USD volume.
  const pressure = useMemo(() => {
    let buy = 0;
    let sell = 0;
    for (const t of trades) (t.side === "buy" ? (buy += t.ethAmount) : (sell += t.ethAmount));
    const total = buy + sell;
    return { buyPct: total > 0 ? (buy / total) * 100 : 50, buy, sell, total };
  }, [trades]);

  const rows = useMemo(
    () =>
      [...trades]
        .filter((t) => (filter === "all" ? true : t.side === filter))
        .sort((a, b) => b.at - a.at)
        .slice(0, 80),
    [trades, filter],
  );

  const counts = useMemo(
    () => ({
      all: trades.length,
      buy: trades.filter((t) => t.side === "buy").length,
      sell: trades.filter((t) => t.side === "sell").length,
    }),
    [trades],
  );

  // Freshest trade id, so only genuinely new rows flash (not every re-render).
  const seen = useRef<string | null>(null);
  const newestId = rows[0]?.id;
  const flashId = newestId && newestId !== seen.current ? newestId : null;
  useEffect(() => {
    if (newestId) seen.current = newestId;
  }, [newestId]);

  if (trades.length === 0) return null;

  return (
    <div className="rounded-2xl bg-zinc-900/40">
      {/* header: title + filters */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-black text-zinc-200">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          Order Book
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{trades.length} trades</span>
        <div className="ml-auto flex overflow-hidden rounded-full bg-zinc-900 p-0.5 text-[11px] font-bold">
          {(
            [
              ["all", "All"],
              ["buy", "Buys"],
              ["sell", "Sells"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-2.5 py-0.5 transition ${
                filter === key
                  ? key === "sell"
                    ? "bg-red-500/80 text-white"
                    : key === "buy"
                      ? "bg-emerald-500/80 text-zinc-950"
                      : "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label} <span className="opacity-60">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* buy/sell pressure bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold">
        <span className="text-emerald-400">{pressure.buyPct.toFixed(0)}% buys</span>
        <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-red-500/40">
          <div className="h-full bg-emerald-500" style={{ width: `${pressure.buyPct}%` }} />
        </div>
        <span className="text-red-400">{(100 - pressure.buyPct).toFixed(0)}% sells</span>
      </div>

      {/* the tape */}
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-950/90 text-[9px] uppercase tracking-wide text-zinc-500 backdrop-blur">
            <tr>
              <th className="px-3 py-1.5 font-bold">Type</th>
              <th className="px-2 py-1.5 text-right font-bold">USD</th>
              <th className="hidden px-2 py-1.5 text-right font-bold sm:table-cell">{symbol}</th>
              <th className="px-2 py-1.5 font-bold">Maker</th>
              <th className="px-3 py-1.5 text-right font-bold">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const buy = t.side === "buy";
              const usd = t.ethAmount * ethUsd;
              const whale = t.ethAmount >= whaleEth && whaleEth > 0;
              const mine = !!me && t.userAddress.toLowerCase() === me.toLowerCase();
              const name =
                t.displayName ?? `${t.userAddress.slice(0, 6)}…${t.userAddress.slice(-4)}`;
              return (
                <tr
                  key={t.id}
                  className={`${t.id === flashId ? "ob-flash" : ""} ${
                    mine ? "bg-lime-400/[0.05]" : ""
                  } ${buy ? "hover:bg-emerald-500/[0.06]" : "hover:bg-red-500/[0.06]"}`}
                >
                  <td className="px-3 py-1.5">
                    <span className={`font-black ${buy ? "text-emerald-400" : "text-red-400"}`}>
                      {buy ? "BUY" : "SELL"}
                    </span>
                    {whale && <span title="whale clip"> 🐋</span>}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono font-bold ${
                      buy ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {money(usd)}
                  </td>
                  <td className="hidden px-2 py-1.5 text-right font-mono text-zinc-400 sm:table-cell">
                    {tokens(t.tokenAmount)}
                  </td>
                  <td className="max-w-[9rem] px-2 py-1.5">
                    <Link
                      href={`/profile/${t.userAddress}`}
                      className="flex items-center gap-1.5 truncate hover:underline"
                    >
                      {t.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.avatarUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[8px] font-bold text-zinc-400">
                          {name.replace(/^0x/i, "").slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="truncate text-zinc-300">{name}</span>
                      {t.isCreator && (
                        <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[8px] font-black uppercase text-amber-300">
                          dev
                        </span>
                      )}
                      {mine && (
                        <span className="shrink-0 rounded bg-lime-400/20 px-1 text-[8px] font-black uppercase text-lime-300">
                          you
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-500">{ago(t.at, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
