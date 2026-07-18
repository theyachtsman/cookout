"use client";

import { useCallback, useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { arenaAddress, arenaBalance, arenaWithdraw, hasArenaWallet, registerArenaAddress } from "../lib/arenaWallet";
import { fundArenaWallet } from "../lib/chainTx";
import { playDeposit } from "../lib/sfx";
import { useSession } from "../lib/session";

/**
 * The Arena Wallet panel — deposit once, trade hot.
 *
 * Funding moves ETH from the player's main wallet into a burner key held in
 * this browser (ONE wallet confirmation). Every pull-up, buy, and sell after
 * that signs locally with zero prompts. Withdraw sweeps back to the main
 * wallet. Non-custodial: the key never leaves the browser.
 */
export function ArenaWalletPanel({ round }: { round: Round }) {
  const { profile } = useSession();
  const [bal, setBal] = useState<number | null>(null);
  const [amount, setAmount] = useState("0.005");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const chainId = round.chain?.chainId;

  const refresh = useCallback(() => {
    if (!chainId || !hasArenaWallet()) return setBal(hasArenaWallet() ? null : 0);
    arenaBalance(chainId).then(setBal).catch(() => {});
  }, [chainId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  // Keep the burner → profile link fresh so mirrored trades credit the player.
  useEffect(() => {
    if (profile && hasArenaWallet()) void registerArenaAddress();
  }, [profile]);

  if (!round.chain || !profile) return null;
  const hot = (bal ?? 0) > 0.0002;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setError("");
    setBusy(key);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={`rounded-xl border p-4 ${hot ? "border-lime-400/50" : "border-zinc-800"}`}>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-black text-zinc-200">
          ⚡ Arena Wallet{" "}
          {hot && (
            <span className="ml-1 rounded bg-lime-400/15 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
              HOT — instant trades
            </span>
          )}
        </h4>
        <span className="font-mono text-sm font-bold text-zinc-200">
          {bal !== null ? `${bal.toFixed(4)} ETH` : "—"}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-zinc-500">
        {hot
          ? "Buys, sells, and pull-ups fire instantly from this balance — no wallet pop-ups."
          : "Deposit once (one wallet confirmation), then every trade fires instantly with no pop-ups. The key lives only in this browser — fund what you'll play with."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm"
        />
        <button
          disabled={busy !== ""}
          onClick={() =>
            void run("fund", async () => {
              await fundArenaWallet(chainId!, amount);
              playDeposit();
            })
          }
          className="rounded-lg bg-lime-400 px-4 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
        >
          {busy === "fund" ? "Confirm in wallet…" : "Deposit"}
        </button>
        {hot && (
          <button
            disabled={busy !== ""}
            onClick={() =>
              void run("withdraw", () =>
                arenaWithdraw(chainId!, profile.address as `0x${string}`),
              )
            }
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
          >
            {busy === "withdraw" ? "Sweeping…" : "Withdraw all"}
          </button>
        )}
      </div>
      {hasArenaWallet() && (
        <p className="mt-2 font-mono text-[10px] text-zinc-600">
          {arenaAddress().slice(0, 10)}…{arenaAddress().slice(-6)}
        </p>
      )}
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
