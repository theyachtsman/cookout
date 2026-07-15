"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export function TradePanel({
  roundId,
  position,
  onTraded,
}: {
  roundId: string;
  position: { tokens: number; costBasisEth: number; realizedPnl: number } | null;
  onTraded: () => void;
}) {
  const { profile, signIn } = useSession();
  const [custom, setCustom] = useState("0.5");
  const [error, setError] = useState("");

  const trade = async (side: "buy" | "sell", body: Record<string, number>) => {
    setError("");
    try {
      await api(`/api/rounds/${roundId}/trade`, { body: { side, ...body } });
      onTraded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!profile)
    return (
      <div className="rounded-xl border border-zinc-800 p-4">
        <button
          onClick={() => void signIn()}
          className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Connect Wallet to Trade
        </button>
      </div>
    );

  return (
    <div className="rounded-xl border border-zinc-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm"
        />
        <button
          onClick={() => void trade("buy", { eth: Number(custom) })}
          className="rounded-lg bg-emerald-600 px-5 py-2 font-black text-white hover:bg-emerald-500"
        >
          Buy
        </button>
        {[0.1, 0.5, 1].map((v) => (
          <button
            key={v}
            onClick={() => void trade("buy", { eth: v })}
            className="rounded bg-emerald-600/20 px-3 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-600/40"
          >
            +{v}
          </button>
        ))}
        <div className="mx-2 h-8 w-px bg-zinc-800" />
        {[25, 50, 75].map((p) => (
          <button
            key={p}
            onClick={() => void trade("sell", { pct: p })}
            className="rounded bg-red-600/20 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-600/40"
          >
            Sell {p}%
          </button>
        ))}
        <button
          onClick={() => void trade("sell", { pct: 100 })}
          className="rounded-lg bg-red-600 px-5 py-2 font-black text-white hover:bg-red-500"
        >
          Sell All
        </button>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          bal {profile.paperBalance.toFixed(2)} · holding {position ? position.tokens.toFixed(0) : 0} tokens
        </span>
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
