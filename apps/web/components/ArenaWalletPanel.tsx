"use client";

import { useCallback, useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { arenaAddress, arenaBalance, arenaWithdraw, hasArenaWallet, logPaperArenaTx, registerArenaAddress } from "../lib/arenaWallet";
import { api } from "../lib/api";
import { fundArenaWallet } from "../lib/chainTx";
import { playDeposit } from "../lib/sfx";
import { useSession } from "../lib/session";
import { fmtAmount, useDenomPref, useEthUsd } from "../lib/ethUsd";
import { DenomToggle } from "./DenomToggle";

/**
 * The Arena Wallet panel — deposit once, trade hot.
 *
 * Funding moves ETH from the player's main wallet into a burner key held in
 * this browser (ONE wallet confirmation). Every pull-up, buy, and sell after
 * that signs locally with zero prompts. Withdraw sweeps back to the main
 * wallet. Non-custodial: the key never leaves the browser.
 */
export function ArenaWalletPanel({ round }: { round: Round }) {
  const { profile, refresh: refreshProfile } = useSession();
  const peg = useEthUsd();
  const [usd, setUsd] = useDenomPref();
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

  if (!profile) return null;

  // Paper rounds run the same flow with pETH so the habit transfers: money
  // sitting in your bank can't trade until you stake it into the arena.
  if (!round.chain)
    return <PaperArena profile={profile} refresh={refreshProfile} peg={peg} usd={usd} setUsd={setUsd} />;

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
          ⚡ Arena Account{" "}
          {hot && (
            <span className="ml-1 rounded bg-lime-400/15 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
              HOT · instant trades
            </span>
          )}
        </h4>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-zinc-200">
            {bal !== null ? fmtAmount(bal, usd, peg, "ETH", 4) : "—"}
          </span>
          <DenomToggle usd={usd} onChange={setUsd} native="ETH" />
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-zinc-500">
        {hot
          ? "Buys, sells, and pull-ups fire instantly from this balance, with no wallet pop-ups."
          : "Deposit once (one wallet confirmation), then every trade fires instantly with no pop-ups. The key lives only in this browser, so fund what you'll play with."}
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


/** Paper-beta arena wallet: deposit pETH from the bank to make it playable. */
function PaperArena({
  profile,
  refresh,
  peg,
  usd,
  setUsd,
}: {
  profile: { paperBalance: number; arenaBalance?: number };
  refresh: () => void;
  peg: number;
  usd: boolean;
  setUsd: (v: boolean) => void;
}) {
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const bank = profile.paperBalance;
  const arena = profile.arenaBalance ?? 0;
  const hot = arena > 0;

  const move = async (direction: "deposit" | "withdraw") => {
    setError("");
    setBusy(direction);
    try {
      const p = await api<{ paperBalance: number; arenaBalance?: number }>(
        "/api/me/arena/transfer",
        { body: { amount: Number(amount), direction } },
      );
      // Log the real delta so the /wallet ledger records deposits made here too.
      const moved = Math.abs((p.arenaBalance ?? 0) - arena);
      if (moved > 0)
        logPaperArenaTx({
          kind: direction,
          amount: moved,
          bankAfter: p.paperBalance,
          arenaAfter: p.arenaBalance ?? 0,
          at: Date.now(),
        });
      if (direction === "deposit") playDeposit();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={`rounded-xl border p-4 ${hot ? "border-lime-400/50" : "border-amber-400/50"}`}>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-black text-zinc-200">
          ⚡ Arena Account{" "}
          {hot ? (
            <span className="ml-1 rounded bg-lime-400/15 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
              READY
            </span>
          ) : (
            <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              EMPTY
            </span>
          )}
        </h4>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-zinc-200">
            {fmtAmount(arena, usd, peg)}
          </span>
          <DenomToggle usd={usd} onChange={setUsd} />
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-zinc-500">
        {hot
          ? "This is what you can pull up and trade with. Anything left in the bank is safe."
          : "Nothing here yet. Move some pETH in and you can pull up. This is how it'll work with real ETH later."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm"
        />
        <button
          disabled={busy !== ""}
          onClick={() => void move("deposit")}
          className="rounded-lg bg-lime-400 px-4 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
        >
          {busy === "deposit" ? "…" : "Deposit"}
        </button>
        {hot && (
          <button
            disabled={busy !== ""}
            onClick={() => void move("withdraw")}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
          >
            {busy === "withdraw" ? "…" : "Withdraw"}
          </button>
        )}
        <button
          onClick={() => setAmount(String(Math.floor(bank * 100) / 100))}
          className="text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          bank {fmtAmount(bank, usd, peg, "pETH", 2)} · max
        </button>
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
