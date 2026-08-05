"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setSpendConfirmer, spendCapEth } from "../lib/cookoutWallet";

/**
 * The confirmation sheet for large spends.
 *
 * The Cookout Wallet signs silently, which is the only way a round is playable
 * — a prompt on every buy makes the game unusable. The cost of that is real:
 * anything on the page can move funds without the player seeing it, and this is
 * the wallet their deposits land in. This is where that trade-off gets a floor.
 *
 * Mounted once, near the root: the guard lives at the send chokepoint in
 * `cookoutWallet`, so this only has to supply the "ask the human" half.
 */
export function SpendGuard() {
  const [ask, setAsk] = useState<{ eth: number; to: string } | null>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (eth: number, to: string) =>
      new Promise<boolean>((resolve) => {
        decide.current = resolve;
        setAsk({ eth, to });
      }),
    [],
  );

  useEffect(() => {
    setSpendConfirmer(confirm);
    return () => setSpendConfirmer(null);
  }, [confirm]);

  const answer = (ok: boolean) => {
    decide.current?.(ok);
    decide.current = null;
    setAsk(null);
  };

  if (!ask) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-5 ring-1 ring-white/10">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-300">
          Confirm a large spend
        </div>
        <div className="mt-2 font-mono text-3xl font-black text-zinc-50">
          {ask.eth.toFixed(4)} <span className="text-lg text-zinc-500">ETH</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Smaller trades fire instantly without asking, so rounds stay playable. This one is over
          your {spendCapEth()} ETH limit, so it needs a look first.
        </p>
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-600">to {ask.to}</p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => answer(false)}
            className="flex-1 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={() => answer(true)}
            className="flex-1 rounded-xl bg-lime-400 px-4 py-2.5 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
