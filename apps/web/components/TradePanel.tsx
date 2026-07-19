"use client";

import { useCallback, useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { api } from "../lib/api";
import { chainBuy, chainSell, walletEthBalance, walletTokenBalanceWei } from "../lib/chainTx";
import { useSession } from "../lib/session";
import { playBuy, playSell, setSfxMuted, sfxMuted } from "../lib/sfx";

/**
 * The trade widget (pump.fun-style, Cookout skin): Buy/Sell tabs, a big
 * centered amount, balance line, one full-width action button, and quick
 * chips — amounts for buys, percentages for sells. Paper rounds hit the
 * paper API; chain rounds fire wallet/arena transactions.
 */
export function TradePanel({
  round,
  position,
  onTraded,
}: {
  round: Round;
  position: { tokens: number; costBasisEth: number; realizedPnl: number } | null;
  onTraded: () => void;
}) {
  const { profile, signIn } = useSession();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [pct, setPct] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => setMuted(sfxMuted()), []);
  const onChain = !!round.chain;
  const unit = onChain ? "ETH" : "pETH";

  // Chain rounds trade from the wallet, so balances come from the chain too.
  const [ethBal, setEthBal] = useState<number | null>(null);
  const [tokenBal, setTokenBal] = useState<bigint | null>(null);
  const refreshChainBalances = useCallback(() => {
    if (!round.chain || !profile) return;
    walletEthBalance(round.chain.chainId).then(setEthBal).catch(() => {});
    walletTokenBalanceWei(round).then(setTokenBal).catch(() => {});
  }, [round, profile]);
  useEffect(() => {
    refreshChainBalances();
    if (!onChain) return;
    const t = setInterval(refreshChainBalances, 10_000);
    return () => clearInterval(t);
  }, [onChain, refreshChainBalances]);

  const trade = async () => {
    setError("");
    setPending(true);
    try {
      if (tab === "buy") {
        const eth = Number(amount);
        if (!(eth > 0)) throw new Error("enter an amount");
        if (onChain) await chainBuy(round, amount);
        else await api(`/api/rounds/${round.id}/trade`, { body: { side: "buy", eth } });
        playBuy();
        setAmount("");
      } else {
        const p = Number(pct);
        if (!(p > 0)) throw new Error("enter a percent");
        if (onChain) {
          const bal = tokenBal ?? (await walletTokenBalanceWei(round));
          const tokens = (bal * BigInt(Math.round(Math.min(100, p) * 100))) / 10_000n;
          if (tokens <= 0n) throw new Error("nothing to sell");
          await chainSell(round, tokens);
        } else {
          await api(`/api/rounds/${round.id}/trade`, { body: { side: "sell", pct: Math.min(100, p) } });
        }
        playSell();
        setPct("");
      }
      refreshChainBalances();
      onTraded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (!profile)
    return (
      <div className="rounded-xl border border-zinc-800 p-4">
        <button
          onClick={() => void signIn()}
          className="w-full rounded-lg bg-lime-400 px-5 py-2.5 font-black text-zinc-950 hover:bg-lime-300"
        >
          Connect Wallet to Trade
        </button>
      </div>
    );

  const balance = onChain ? ethBal : profile.paperBalance;
  const holdingTokens = onChain
    ? tokenBal !== null
      ? Number(tokenBal / 10n ** 18n)
      : null
    : (position?.tokens ?? 0);
  const buying = tab === "buy";
  const value = buying ? amount : pct;
  const setValue = buying ? setAmount : setPct;
  const ready = Number(value) > 0;
  const quickBuys = onChain ? [0.0005, 0.001, 0.002] : [0.1, 0.5, 1];

  return (
    <div className={`rounded-xl border bg-zinc-900/70 p-3 ${onChain ? "border-amber-400/40" : "border-zinc-800"}`}>
      {/* tabs + mute */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 overflow-hidden rounded-full bg-zinc-800/80 p-1">
          <button
            onClick={() => setTab("buy")}
            className={`flex-1 rounded-full py-1.5 text-sm font-black transition ${
              buying ? "bg-emerald-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setTab("sell")}
            className={`flex-1 rounded-full py-1.5 text-sm font-black transition ${
              !buying ? "bg-red-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Sell
          </button>
        </div>
        <button
          onClick={() => {
            setSfxMuted(!muted);
            setMuted(!muted);
          }}
          title={muted ? "unmute sounds" : "mute sounds"}
          className="rounded-lg border border-zinc-800 px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-200"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* the big amount */}
      <div className="mt-4 flex items-baseline justify-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          inputMode="decimal"
          className="w-36 bg-transparent text-center font-mono text-5xl font-black text-zinc-100 placeholder-zinc-700 outline-none"
        />
        <span className="font-mono text-sm font-bold text-zinc-500">{buying ? unit : "%"}</span>
      </div>

      {/* balance / holdings line */}
      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        {buying ? (
          <span>
            Balance{" "}
            <span className="font-mono font-bold text-zinc-200">
              {balance !== null && balance !== undefined ? balance.toFixed(onChain ? 4 : 2) : "…"} {unit}
            </span>
          </span>
        ) : (
          <span>
            Holding{" "}
            <span className="font-mono font-bold text-zinc-200">
              {holdingTokens !== null ? holdingTokens.toLocaleString() : "…"} {round.token.symbol}
            </span>
          </span>
        )}
        {onChain && <span className="font-bold text-amber-300">⚡ on-chain</span>}
      </div>

      {/* action */}
      <button
        disabled={pending || !ready}
        onClick={() => void trade()}
        className={`mt-3 w-full rounded-lg py-2.5 font-black transition active:scale-[0.98] disabled:opacity-60 ${
          buying
            ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            : "bg-red-500 text-zinc-950 hover:bg-red-400"
        }`}
      >
        {pending
          ? "…"
          : !ready
            ? "Enter an amount"
            : buying
              ? `Buy ${value} ${unit}`
              : `Sell ${Math.min(100, Number(value))}%`}
      </button>

      {/* quick chips */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {buying
          ? quickBuys.map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className="rounded-full border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25"
              >
                {v} {unit}
              </button>
            ))
          : [25, 50, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(String(p))}
                className="rounded-full border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25"
              >
                {p}%
              </button>
            ))}
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
