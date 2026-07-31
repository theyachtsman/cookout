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
  ethUsd,
  price,
  variant = "widget",
  balanceOverride,
  onTraded,
}: {
  round: Round;
  position: { tokens: number; costBasisEth: number; realizedPnl: number } | null;
  /** Live ETH/USD peg — enables entering buys in dollars. */
  ethUsd?: number;
  /** Live spot price (native per token) — values the current holding in USD. */
  price?: number;
  /** "bar" is the horizontal strip under the live chart (fast, one row);
   *  "widget" is the tabbed card used for graduated coins in the wild. */
  variant?: "bar" | "widget";
  /** Paper balance to spend/display instead of the Cook Out balance. The Pit
   *  passes the per-match paper stack; the server spends the same thing. */
  balanceOverride?: number;
  onTraded: () => void;
}) {
  const { profile, signIn, promptPlayNow } = useSession();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  // Enter buys in native units or dollars — the widget converts at the peg.
  // Default to dollars: most players think in USD; the toggle flips to coins.
  const [denom, setDenom] = useState<"native" | "usd">("usd");
  const peg = ethUsd && ethUsd > 0 ? ethUsd : 0;
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

  /** One-shot trade used by the horizontal bar's buttons. */
  const fire = async (side: "buy" | "sell", opts: { eth?: number; pct?: number }) => {
    setError("");
    setPending(true);
    try {
      if (side === "buy") {
        const eth = opts.eth ?? 0;
        if (!(eth > 0)) throw new Error("enter an amount");
        if (onChain) await chainBuy(round, String(eth));
        else await api(`/api/rounds/${round.id}/trade`, { body: { side: "buy", eth } });
        playBuy();
      } else {
        const p = Math.min(100, opts.pct ?? 0);
        if (!(p > 0)) throw new Error("nothing to sell");
        if (onChain) {
          const bal = tokenBal ?? (await walletTokenBalanceWei(round));
          const tokens = (bal * BigInt(Math.round(p * 100))) / 10_000n;
          if (tokens <= 0n) throw new Error("nothing to sell");
          await chainSell(round, tokens);
        } else {
          await api(`/api/rounds/${round.id}/trade`, { body: { side: "sell", pct: p } });
        }
        playSell();
      }
      refreshChainBalances();
      onTraded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const trade = async () => {
    setError("");
    setPending(true);
    try {
      if (tab === "buy") {
        const typed = Number(amount);
        if (!(typed > 0)) throw new Error("enter an amount");
        // USD entry converts at the live peg; never treat a dollar figure as
        // raw coins if the peg hasn't landed (would fire a wildly wrong size).
        if (denom === "usd" && !peg) throw new Error("price still loading, try again in a moment");
        const eth = denom === "usd" ? typed / peg : typed;
        if (!(eth > 0)) throw new Error("enter an amount");
        if (onChain) await chainBuy(round, eth.toFixed(18).replace(/0+$/, "") || String(eth));
        else await api(`/api/rounds/${round.id}/trade`, { body: { side: "buy", eth } });
        playBuy();
        // Amount stays put so you can hammer the same size again instantly.
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
      <div className="rounded-2xl bg-zinc-900/40 p-4">
        <button
          onClick={() => (onChain ? void signIn() : promptPlayNow())}
          className="w-full rounded-lg bg-lime-400 px-5 py-2.5 font-black text-zinc-950 hover:bg-lime-300"
        >
          {onChain ? "Connect Wallet to Trade" : "Play to Trade"}
        </button>
      </div>
    );

  // Paper rounds spend the arena balance, same as chain rounds spend the
  // arena wallet. The bank balance isn't playable. In The Pit, the spendable
  // balance is the per-match paper stack (balanceOverride).
  const balance = onChain ? ethBal : (balanceOverride ?? profile.arenaBalance ?? 0);
  const holdingTokens = onChain
    ? tokenBal !== null
      ? Number(tokenBal / 10n ** 18n)
      : null
    : (position?.tokens ?? 0);
  const buying = tab === "buy";
  const value = buying ? amount : pct;
  const setValue = buying ? setAmount : setPct;
  const ready = Number(value) > 0;
  const usdMode = buying && denom === "usd" && !!peg;
  // Quick-buy chips: fixed dollar clips for paper play ($5 / $20 / $50); on-chain
  // rounds spend real testnet ETH, so they keep tiny native clips instead.
  const quickChips = onChain ? [0.0005, 0.001, 0.005] : [5, 20, 50];
  const chipEth = (v: number) => (onChain ? v : peg ? v / peg : 0);
  const chipLabel = (v: number) => (onChain ? `${v}` : `$${v}`);
  // Widget fill: put a chip's size in the input, honoring the active denom.
  const chipFill = (v: number) =>
    onChain ? String(v) : usdMode ? String(v) : peg ? (v / peg).toFixed(4) : "0";
  // What the typed amount is worth in the other denomination.
  const typedNum = Number(amount);
  const convertedHint =
    buying && peg && typedNum > 0
      ? denom === "usd"
        ? `≈ ${(typedNum / peg).toFixed(4)} ${unit}`
        : `≈ $${(typedNum * peg).toFixed(2)}`
      : "";

  // ---- the bar: one fast horizontal row under the live chart ----
  if (variant === "bar") {
    const buyNow = () => void fire("buy", { eth: usdMode && peg ? Number(amount) / peg : Number(amount) });
    return (
      <div
        className={`rounded-xl border bg-zinc-900/70 p-2.5 ${
          onChain ? "border-amber-400/40" : "border-zinc-800"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* amount + denom */}
          <div className="flex items-center gap-1">
            {usdMode && <span className="font-mono text-sm text-zinc-500">$</span>}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && ready && buyNow()}
              placeholder="0"
              inputMode="decimal"
              className="w-20 rounded bg-zinc-950/60 px-2 py-1.5 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-emerald-400/50"
            />
            {peg > 0 && (
              <button
                onClick={() => {
                  const n = Number(amount);
                  const next = denom === "usd" ? "native" : "usd";
                  if (n > 0)
                    setAmount(
                      next === "usd" ? (n * peg).toFixed(2) : (n / peg).toFixed(onChain ? 5 : 4),
                    );
                  setDenom(next);
                }}
                title="switch between dollars and coins"
                className="rounded bg-zinc-800/60 px-1.5 py-1 font-mono text-[10px] font-bold text-zinc-400 hover:text-zinc-200"
              >
                {usdMode ? "USD" : unit}
              </button>
            )}
          </div>

          <button
            disabled={pending || !ready}
            onClick={buyNow}
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-black text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
          >
            {pending ? "…" : "Buy"}
          </button>
          {quickChips.map((v) => (
            <button
              key={v}
              disabled={pending || (!onChain && !peg)}
              onClick={() => void fire("buy", { eth: chipEth(v) })}
              className="rounded bg-emerald-600/20 px-2.5 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-600/40 active:scale-95 disabled:opacity-50"
            >
              +{chipLabel(v)}
            </button>
          ))}

          <div className="mx-1 h-7 w-px bg-zinc-800" />

          {[5, 25, 50].map((p) => (
            <button
              key={p}
              disabled={pending}
              onClick={() => void fire("sell", { pct: p })}
              className="rounded bg-red-600/20 px-2.5 py-2 text-xs font-bold text-red-300 transition hover:bg-red-600/40 active:scale-95 disabled:opacity-50"
            >
              {p}%
            </button>
          ))}
          <button
            disabled={pending}
            onClick={() => void fire("sell", { pct: 100 })}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white transition hover:bg-red-500 active:scale-95 disabled:opacity-50"
          >
            Sell All
          </button>

          <button
            onClick={() => {
              setSfxMuted(!muted);
              setMuted(!muted);
            }}
            title={muted ? "unmute sounds" : "mute sounds"}
            className="ml-auto rounded px-1.5 py-1 text-sm text-zinc-500 hover:text-zinc-200"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>

        {/* Account line — two clear, roomy stats instead of one cramped string. */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-zinc-950/60 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Balance</div>
            <div className="mt-0.5 flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="truncate font-mono text-base font-black tabular-nums text-zinc-100">
                {balance !== null && balance !== undefined ? balance.toFixed(onChain ? 4 : 2) : "…"}
              </span>
              <span className="shrink-0 text-[11px] font-bold text-zinc-500">{unit}</span>
              {peg > 0 && balance !== null && balance !== undefined && (
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-emerald-400/80">
                  ${(balance * peg).toFixed(2)}
                </span>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              Holding {round.token.symbol}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
              <span className="truncate font-mono text-base font-black tabular-nums text-zinc-100">
                {holdingTokens !== null ? holdingTokens.toLocaleString() : "…"}
              </span>
              {peg > 0 && price !== undefined && holdingTokens !== null && (
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-emerald-400/80">
                  ${(holdingTokens * price * peg).toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
        {convertedHint && <div className="mt-1.5 font-mono text-[11px] text-zinc-400">{convertedHint}</div>}
        {error && <div className="mt-1.5 text-xs text-red-400">{error}</div>}
      </div>
    );
  }

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
          className="rounded-lg bg-zinc-800/60 px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-700"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* the big amount */}
      <div className="mt-4 flex items-baseline justify-center gap-2">
        {usdMode && <span className="font-mono text-3xl font-black text-zinc-500">$</span>}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          inputMode="decimal"
          className="w-36 bg-transparent text-center font-mono text-5xl font-black text-zinc-100 placeholder-zinc-700 outline-none"
        />
        <span className="font-mono text-sm font-bold text-zinc-500">
          {buying ? (usdMode ? "USD" : unit) : "%"}
        </span>
      </div>
      {/* denomination toggle + live conversion */}
      {buying && peg > 0 && (
        <div className="mt-1 flex items-center justify-center gap-2">
          <div className="flex overflow-hidden rounded-full bg-zinc-900/70 text-[10px] font-bold">
            {(
              [
                ["native", unit],
                ["usd", "USD"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  // Carry the value across so the size doesn't jump.
                  const n = Number(amount);
                  if (n > 0) {
                    setAmount(
                      key === "usd"
                        ? (n * peg).toFixed(2)
                        : (n / peg).toFixed(unit === "ETH" ? 5 : 4),
                    );
                  }
                  setDenom(key);
                }}
                className={`px-2.5 py-1 ${
                  denom === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {convertedHint && <span className="font-mono text-[11px] text-zinc-500">{convertedHint}</span>}
        </div>
      )}

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
              ? usdMode
                ? `Buy $${value}`
                : `Buy ${value} ${unit}`
              : `Sell ${Math.min(100, Number(value))}%`}
      </button>

      {/* quick chips */}
      <div className={`mt-2 grid gap-1.5 ${buying ? "grid-cols-3" : "grid-cols-4"}`}>
        {buying
          ? quickChips.map((v) => (
              <button
                key={v}
                onClick={() => setAmount(chipFill(v))}
                className="rounded-full bg-emerald-500/15 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25"
              >
                {chipLabel(v)}
              </button>
            ))
          : [5, 25, 50, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(String(p))}
                className="rounded-full bg-red-500/15 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25"
              >
                {p}%
              </button>
            ))}
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
