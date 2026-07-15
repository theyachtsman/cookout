"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Holder {
  address: string;
  displayName?: string;
  avatarUrl?: string;
  badge?: string;
  tokens: number;
  pctOfSupply: number;
  valueEth: number;
}

const RANK = ["👑", "🥈", "🥉"];

/** Running top-holders board — biggest bags right now, refreshed live. */
export function TopHolders({ roundId, ethUsd = 1925 }: { roundId: string; ethUsd?: number }) {
  const [holders, setHolders] = useState<Holder[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<{ holders: Holder[] }>(`/api/rounds/${roundId}/holders`)
        .then((d) => alive && setHolders(d.holders))
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [roundId]);

  const maxPct = holders[0]?.pctOfSupply || 1;

  return (
    <div className="scanlines rounded-xl border border-zinc-800 p-4">
      <h4 className="mb-2 text-sm font-black tracking-wide text-lime-300">🏆 TOP HOLDERS</h4>
      <div className="space-y-1.5">
        {holders.map((h, i) => (
          <a
            key={h.address}
            href={`/profile/${h.address}`}
            className="relative block overflow-hidden rounded-lg bg-zinc-900 px-2 py-1.5 transition hover:bg-zinc-800"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 bg-lime-400/10 transition-[width] duration-700"
              style={{ width: `${(h.pctOfSupply / maxPct) * 100}%` }}
            />
            <div className="relative flex items-center gap-2 text-sm">
              <span className="w-6 text-center">{RANK[i] ?? <span className="font-mono text-xs text-zinc-500">{i + 1}</span>}</span>
              {h.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[9px]">
                  {(h.displayName ?? h.address.slice(2, 4)).slice(0, 2)}
                </span>
              )}
              {h.badge && <span className="text-xs">{h.badge}</span>}
              <span className="truncate">
                {h.displayName ?? `${h.address.slice(0, 6)}…${h.address.slice(-4)}`}
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs text-lime-300">
                {h.pctOfSupply.toFixed(1)}%
              </span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                ${(h.valueEth * ethUsd).toFixed(0)}
              </span>
            </div>
          </a>
        ))}
        {holders.length === 0 && (
          <div className="py-3 text-center text-xs text-zinc-600">
            no bags yet — auction settles soon
          </div>
        )}
      </div>
    </div>
  );
}
