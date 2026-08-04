"use client";

import { useCallback, useEffect, useState } from "react";
import type { BurgerTxn } from "@cookout/shared";
import { api } from "../lib/api";
import { onBurger } from "../lib/burgerBus";

/**
 * A Burger balance + recent history card for the Cook Out Balance page.
 *
 * The full Burger wallet lives behind its own tab, but $BURG is a real balance
 * on this account and was easy to miss there. This puts the number and the last
 * few movements on the page you land on, with a way through to the rest.
 */

interface BurgerState {
  enabled: boolean;
  balance: number;
  earned: number;
  purchased: number;
  spent: number;
  ledger: BurgerTxn[];
}

const SOURCE_LABEL: Record<string, string> = {
  admin_grant: "Admin grant",
  match_complete: "Match played",
  daily_quest: "Daily quest",
  weekly_quest: "Weekly challenge",
  xp_milestone: "XP milestone",
  one_time: "Milestone",
  coin_launch: "Coin launched",
  coin_graduation: "Coin served up",
  purchase: "Purchased",
  loot_box: "Recruit Crate",
  collection: "Collection set",
  pit: "The Pit",
};

export function BurgerSummary({ onOpenFull }: { onOpenFull?: () => void }) {
  const [state, setState] = useState<BurgerState | null>(null);

  const load = useCallback(() => {
    api<BurgerState>("/api/me/burger")
      .then(setState)
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  // Follow live awards and spends so the number never lags the toast.
  useEffect(() => onBurger(() => load()), [load]);

  if (!state?.enabled) return null;
  const recent = state.ledger.slice(0, 5);

  return (
    <section className="rounded-2xl bg-amber-500/[0.07] p-5 ring-1 ring-amber-400/20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Burgers · $BURG</div>
          <div className="font-mono text-3xl font-black text-amber-300">
            🍔 {Math.floor(state.balance).toLocaleString()}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {Math.floor(state.earned).toLocaleString()} earned ·{" "}
            {Math.floor(state.purchased).toLocaleString()} bought ·{" "}
            {Math.floor(state.spent).toLocaleString()} spent
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href="/recruit"
            className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-amber-300"
          >
            📦 Recruit
          </a>
          {onOpenFull && (
            <button
              onClick={onOpenFull}
              className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
            >
              Full history →
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
          Recent Burger activity
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl bg-zinc-950/40 p-4 text-center text-xs text-zinc-500">
            Nothing yet. Play matches and clear quests to earn Burgers.
          </div>
        ) : (
          <div className="space-y-1">
            {recent.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg bg-zinc-950/40 px-3 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {t.label || SOURCE_LABEL[t.source] || t.source}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-600">
                  {new Date(t.at).toLocaleDateString()}
                </span>
                <span
                  className={`w-16 shrink-0 text-right font-mono font-black ${
                    t.amount >= 0 ? "text-lime-300" : "text-red-300"
                  }`}
                >
                  {t.amount >= 0 ? "+" : ""}
                  {Math.round(t.amount).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
