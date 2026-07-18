"use client";

import { useCallback, useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { api } from "../lib/api";
import { chainBuy, chainSell, walletEthBalance, walletTokenBalanceWei } from "../lib/chainTx";
import { useSession } from "../lib/session";
import { playBuy, playSell } from "../lib/sfx";

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
  const [custom, setCustom] = useState("0.1");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const onChain = !!round.chain;

  // Chain rounds trade from the wallet, so balances come from the chain too.
  const [ethBal, setEthBal] = useState<number | null>(null);
  const [tokenBal, setTokenBal] = useState<bigint | null>(null);
  const refreshChainBalances = useCallback(() => {
    if (!round.chain || !profile) return;
    walletEthBalance(round.chain?.chainId).then(setEthBal).catch(() => {});
    walletTokenBalanceWei(round).then(setTokenBal).catch(() => {});
  }, [round, profile]);
  useEffect(() => {
    refreshChainBalances();
    if (!onChain) return;
    const t = setInterval(refreshChainBalances, 10_000);
    return () => clearInterval(t);
  }, [onChain, refreshChainBalances]);

  const paperTrade = async (side: "buy" | "sell", body: Record<string, number>) => {
    await api(`/api/rounds/${round.id}/trade`, { body: { side, ...body } });
  };

  const walletTrade = async (side: "buy" | "sell", body: { eth?: number; pct?: number }) => {
    if (side === "buy") {
      await chainBuy(round, String(body.eth ?? 0));
    } else {
      const bal = tokenBal ?? (await walletTokenBalanceWei(round));
      const tokens = (bal * BigInt(Math.round((body.pct ?? 0) * 100))) / 10_000n;
      if (tokens <= 0n) throw new Error("nothing to sell");
      await chainSell(round, tokens);
    }
  };

  const trade = async (side: "buy" | "sell", body: { eth?: number; pct?: number }) => {
    setError("");
    setPending(true);
    try {
      if (onChain) await walletTrade(side, body);
      else await paperTrade(side, body as Record<string, number>);
      if (side === "buy") playBuy();
      else playSell();
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
          className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Connect Wallet to Trade
        </button>
      </div>
    );

  const unit = onChain ? "ETH" : "pETH";
  const holdingTokens = onChain
    ? tokenBal !== null
      ? Number(tokenBal / 10n ** 18n)
      : null
    : (position?.tokens ?? 0);

  return (
    <div className={`rounded-xl border p-4 ${onChain ? "border-amber-400/40" : "border-zinc-800"}`}>
      {onChain && (
        <div className="mb-2 text-[11px] font-bold text-amber-300">
          ⛓️ Real on-chain round — trades are wallet transactions in real testnet {unit}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm"
        />
        <button
          disabled={pending}
          onClick={() => void trade("buy", { eth: Number(custom) })}
          className="rounded-lg bg-emerald-600 px-5 py-2 font-black text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "…" : "Buy"}
        </button>
        {(onChain ? [0.0005, 0.001, 0.002] : [0.02, 0.05, 0.1]).map((v) => (
          <button
            key={v}
            disabled={pending}
            onClick={() => void trade("buy", { eth: v })}
            className="rounded bg-emerald-600/20 px-3 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-600/40 disabled:opacity-50"
          >
            +{v}
          </button>
        ))}
        <div className="mx-2 h-8 w-px bg-zinc-800" />
        {[25, 50, 75].map((p) => (
          <button
            key={p}
            disabled={pending}
            onClick={() => void trade("sell", { pct: p })}
            className="rounded bg-red-600/20 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-600/40 disabled:opacity-50"
          >
            Sell {p}%
          </button>
        ))}
        <button
          disabled={pending}
          onClick={() => void trade("sell", { pct: 100 })}
          className="rounded-lg bg-red-600 px-5 py-2 font-black text-white hover:bg-red-500 disabled:opacity-50"
        >
          Sell All
        </button>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          bal{" "}
          {onChain
            ? ethBal !== null
              ? ethBal.toFixed(4)
              : "…"
            : profile.paperBalance.toFixed(2)}{" "}
          {unit} · holding {holdingTokens !== null ? holdingTokens.toLocaleString() : "…"} tokens
        </span>
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}
