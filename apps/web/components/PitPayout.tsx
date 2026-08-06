"use client";

import { useCallback, useEffect, useState } from "react";
import type { PitChain } from "@cookout/shared";
import { claimPitPool, refundPitPool } from "../lib/pitPool";
import { cookoutAddress, ethCall, onCookoutSigner, signerReady } from "../lib/cookoutWallet";

/**
 * Collecting from a finished Pit match, and getting out of an abandoned one.
 *
 * Both pools pay pull-based: winnings sit in the contract until the winner
 * asks for them. That is the safe design, and it has a cost — if nothing in the
 * UI ever offers the button, the money may as well not be theirs. Same for the
 * refund window: "anyone can open refunds after 24 hours" is a guarantee only
 * if a player can actually do it, so this shows that path too, without needing
 * anything from us.
 */

const SEL = {
  pending: "0x5eebea20", // pending(address)
  resolved: "0x3f6fa655", // resolved()
  refunding: "0xf43e98c7", // refunding()
  refundAfter: "0x328719f6", // refundAfter()
};

const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const num = (hex: string) => (hex && hex !== "0x" ? BigInt(hex) : 0n);
const flag = (hex: string) => num(hex) === 1n;

interface PoolState {
  which: "prediction" | "battle";
  label: string;
  address: string;
  pending: bigint;
  resolved: boolean;
  refunding: boolean;
}

export function PitPayout({ pit }: { pit: PitChain }) {
  const [pools, setPools] = useState<PoolState[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [ready, setReady] = useState(signerReady());

  useEffect(() => onCookoutSigner(() => setReady(signerReady())), []);

  const load = useCallback(async () => {
    const me = cookoutAddress();
    if (!me) return;
    const read = async (which: "prediction" | "battle", label: string, address: string) => {
      const [p, r, f] = await Promise.all([
        ethCall(pit.chainId, address, SEL.pending + pad(me)),
        ethCall(pit.chainId, address, SEL.resolved),
        ethCall(pit.chainId, address, SEL.refunding),
      ]);
      return {
        which,
        label,
        address,
        pending: num(p),
        resolved: flag(r),
        refunding: flag(f),
      } satisfies PoolState;
    };
    try {
      setPools(
        await Promise.all([
          read("prediction", "Prediction pool", pit.predictionPool),
          read("battle", "Battle the Goon Squad", pit.battlePool),
        ]),
      );
    } catch {
      /* a failed read just means nothing to show yet */
    }
  }, [pit]);

  useEffect(() => {
    void load();
  }, [load, ready]);

  const act = async (pool: PoolState, kind: "claim" | "refund") => {
    setBusy(`${pool.which}:${kind}`);
    setError("");
    setDone("");
    try {
      if (kind === "claim") await claimPitPool(pit, pool.which);
      else await refundPitPool(pit, pool.which, pool.refunding);
      setDone(kind === "claim" ? "Paid out to your Cookout Wallet." : "Stake returned.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const windowOpen = Date.now() >= pit.refundAfter;
  const actionable = pools.filter((p) => p.pending > 0n);
  if (!ready || actionable.length === 0) return null;

  return (
    <section className="rounded-2xl bg-lime-400/[0.07] p-4 ring-1 ring-lime-400/25">
      <h3 className="text-sm font-black text-lime-300">Your money in this match</h3>
      <div className="mt-2 space-y-2">
        {actionable.map((p) => {
          // Refund only where it is genuinely available: the match was never
          // resolved and the window has passed. Offering it otherwise would be
          // a button that always reverts.
          const canRefund = !p.resolved && (p.refunding || windowOpen);
          const key = `${p.which}:${canRefund ? "refund" : "claim"}`;
          return (
            <div
              key={p.which}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-950/50 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-zinc-200">{p.label}</div>
                <div className="font-mono text-lg font-black text-lime-300">
                  {(Number(p.pending) / 1e18).toFixed(5)} ETH
                </div>
              </div>
              <button
                disabled={!!busy}
                onClick={() => void act(p, canRefund ? "refund" : "claim")}
                className="shrink-0 rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
              >
                {busy === key ? "…" : canRefund ? "Refund my stake" : "Claim"}
              </button>
            </div>
          );
        })}
      </div>
      {!pools.some((p) => p.resolved) && !windowOpen && (
        <p className="mt-2 text-[11px] leading-snug text-zinc-500">
          If this match is never settled, you can take your stake back yourself from{" "}
          {new Date(pit.refundAfter).toLocaleString()}. Nobody has to approve it.
        </p>
      )}
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      {done && <div className="mt-2 text-sm text-lime-300">{done}</div>}
    </section>
  );
}
