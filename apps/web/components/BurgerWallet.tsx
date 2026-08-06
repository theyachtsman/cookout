"use client";

import { useCallback, useEffect, useState } from "react";
import type { BurgerTxn } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { onBurger } from "../lib/burgerBus";
import { BurgerBalance } from "./BurgerBalance";
import { ExpandableRows } from "./ProfileUI";

interface BurgerState {
  enabled: boolean;
  /** False while the shop is switched off — earning is unaffected. */
  canPurchase: boolean;
  balance: number;
  earned: number;
  purchased: number;
  spent: number;
  burgersPerEth: number;
  arenaBalance: number;
  ledger: BurgerTxn[];
}

const CAT_CLASS: Record<BurgerTxn["category"], string> = {
  reward: "text-amber-300",
  purchase: "text-amber-300",
  admin_grant: "text-amber-300",
  refund: "text-amber-300",
  adjustment: "text-red-400",
  spend: "text-red-400",
};

/**
 * The 🍔 $BURG wallet: a live balance, a shop to buy Burgers with Cook Out
 * balance, and the full Burger transaction history. Burgers are a permanent
 * second currency (earned power) — separate from the Cook Out balance above.
 */
export function BurgerWallet() {
  const { profile, refresh } = useSession();
  const [state, setState] = useState<BurgerState | null>(null);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api<BurgerState>("/api/me/burger").then(setState).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  // Refresh the history whenever a reward lands live.
  useEffect(() => onBurger(() => load()), [load]);

  if (!profile || (state && !state.enabled)) return null;

  const rate = state?.burgersPerEth ?? 0;
  const spend = Number(amount) || 0;
  const preview = Math.floor(spend * rate);

  const buy = async () => {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const out = await api<{ burgers: number }>("/api/me/burger/purchase", { body: { eth: spend } });
      setMsg(`Bought ${out.burgers.toLocaleString()} $BURG`);
      load();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-amber-500/[0.06] p-5 ring-1 ring-amber-400/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-amber-300/90">Burger Balance</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            $BURG is earned power — a permanent currency toward future Recruit Crates.
          </p>
        </div>
        <BurgerBalance initial={state?.balance ?? profile.burgerBalance ?? 0} size="lg" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Earned" value={state?.earned ?? 0} />
        <Stat label="Purchased" value={state?.purchased ?? 0} />
        <Stat label="Spent" value={state?.spent ?? 0} />
      </div>

      {/* The shop, only while buying is on. Pricing $BURG against paper or
          testnet ETH would set a rate against money that isn't real, and that
          is the number people would carry into mainnet as the expectation. */}
      {state?.canPurchase === false ? (
        <div className="mt-4 rounded-xl bg-zinc-950/40 p-4">
          <h3 className="mb-1 text-xs font-black uppercase tracking-wide text-zinc-400">
            Buying $BURG
          </h3>
          <p className="text-sm text-zinc-500">
            The shop is closed for now — $BURG is earned only. Finish matches, clear quests, launch
            coins, and hit milestones.
          </p>
        </div>
      ) : (
      <div className="mt-4 rounded-xl bg-zinc-950/40 p-4">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-400">Buy $BURG</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-24 rounded bg-zinc-950/60 px-3 py-2 font-mono"
          />
          <span className="text-sm text-zinc-500">pETH →</span>
          <span className="font-mono font-black text-amber-300">🍔 {preview.toLocaleString()}</span>
          <button
            disabled={busy || preview <= 0}
            onClick={() => void buy()}
            className="ml-auto rounded-lg bg-amber-400 px-5 py-2 font-black text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
          >
            {busy ? "…" : "Buy"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Rate: {rate.toLocaleString()} $BURG per pETH · spends your Cook Out balance
          {typeof state?.arenaBalance === "number" && (
            <> (⚡ {state.arenaBalance.toFixed(2)} available)</>
          )}
          . Revenue funds the jackpot, creators, referrals, and Pit pools.
        </p>
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
        {msg && <div className="mt-2 text-sm text-amber-300">{msg}</div>}
      </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-zinc-400">Burger History</h3>
        {!state || state.ledger.length === 0 ? (
          <p className="text-sm text-zinc-600">
            No Burgers yet. Finish matches, clear quests, launch coins, and hit milestones to earn.
          </p>
        ) : (
          <ExpandableRows
            items={state.ledger}
            cap={15}
            maxHeight="max-h-[30rem]"
            render={(e: BurgerTxn) => {
              const credit = e.amount >= 0;
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-xl bg-zinc-950/40 px-3 py-2.5 text-sm">
                  <span className="text-lg">🍔</span>
                  <div className="min-w-0 flex-1">
                    <div className={`font-bold ${CAT_CLASS[e.category]}`}>{e.label}</div>
                    <div className="text-[11px] text-zinc-600">{when(e.at)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold ${credit ? "text-amber-300" : "text-red-400"}`}>
                      {credit ? "+" : "−"}
                      {Math.abs(e.amount).toLocaleString()}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-600">
                      🍔 {e.balanceAfter.toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-950/40 p-2.5">
      <div className="font-mono text-lg font-black text-amber-200">{Math.round(value).toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function when(at: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(at).toLocaleDateString();
}
