"use client";

import { useCallback, useEffect, useState } from "react";
import {
  arenaAddress,
  arenaBalance,
  arenaHistory,
  arenaWithdraw,
  hasArenaWallet,
  registerArenaAddress,
  type ArenaTxEntry,
} from "../../lib/arenaWallet";
import { api } from "../../lib/api";
import { useChainOnly } from "../../lib/chainOnly";
import { fundArenaWallet } from "../../lib/chainTx";
import { useSession } from "../../lib/session";
import { playDeposit } from "../../lib/sfx";

/** Default chain for the site-wide wallet view (Robinhood Chain Testnet). */
const CHAIN_ID = 46630;

const KIND_META: Record<ArenaTxEntry["kind"], { icon: string; label: string; cls: string }> = {
  deposit: { icon: "⬇️", label: "Deposit", cls: "text-lime-300" },
  withdraw: { icon: "⬆️", label: "Withdraw", cls: "text-zinc-300" },
  "pull-up": { icon: "🚪", label: "Pull Up", cls: "text-lime-300" },
  cancel: { icon: "↩️", label: "Cancel intent", cls: "text-zinc-400" },
  claim: { icon: "🎁", label: "Claim fill", cls: "text-amber-300" },
  buy: { icon: "🟢", label: "Buy", cls: "text-emerald-400" },
  sell: { icon: "🔴", label: "Sell", cls: "text-red-400" },
  redeem: { icon: "🏦", label: "Redeem", cls: "text-amber-300" },
  approve: { icon: "✍️", label: "Approve", cls: "text-zinc-400" },
};

export default function WalletPage() {
  const chainOnly = useChainOnly();
  if (!chainOnly) return <PaperWalletPage />;
  return <ChainWalletPage />;
}

/**
 * Paper beta: the same arena-wallet habit, denominated in pETH. Money in the
 * bank is safe and unplayable; money in the arena is what matches spend.
 */
function PaperWalletPage() {
  const { profile, signIn, refresh } = useSession();
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (!profile)
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <h1 className="text-2xl font-black">⚡ Arena Wallet</h1>
        <p className="mt-2 text-sm text-zinc-500">Sign in to stake your pETH.</p>
        <button
          onClick={() => void signIn()}
          className="mt-4 rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Connect
        </button>
      </div>
    );

  const bank = profile.paperBalance;
  const arena = profile.arenaBalance ?? 0;

  const move = async (direction: "deposit" | "withdraw") => {
    setError("");
    setBusy(direction);
    try {
      await api("/api/me/arena/transfer", { body: { amount: Number(amount), direction } });
      if (direction === "deposit") playDeposit();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black">
          ⚡ Arena Wallet
          {arena > 0 && (
            <span className="ml-2 rounded bg-lime-400/15 px-2 py-0.5 text-xs font-bold text-lime-300">
              READY
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Matches spend your arena balance, never your bank. It works exactly like the real
          thing will — get the habit here, where it&apos;s only paper.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-lime-400/40 bg-lime-400/5 p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">In the arena</div>
          <div className="mt-1 font-mono text-3xl font-black text-lime-300">{arena.toFixed(3)}</div>
          <div className="text-xs text-zinc-500">pETH · playable now</div>
        </div>
        <div className="rounded-xl border border-zinc-800 p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">In the bank</div>
          <div className="mt-1 font-mono text-3xl font-black text-zinc-200">{bank.toFixed(3)}</div>
          <div className="text-xs text-zinc-500">pETH · safe, can&apos;t trade</div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 p-5">
        <h2 className="mb-3 text-sm font-black text-zinc-200">Move money</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-24 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono"
          />
          <span className="text-sm text-zinc-500">pETH</span>
          <button
            disabled={busy !== ""}
            onClick={() => void move("deposit")}
            className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
          >
            {busy === "deposit" ? "…" : "Bank → Arena"}
          </button>
          <button
            disabled={busy !== ""}
            onClick={() => void move("withdraw")}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
          >
            {busy === "withdraw" ? "…" : "Arena → Bank"}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Winnings, creator fees, and jackpot payouts land in the bank. Stake what you want to
          play with; pull the rest back out any time you&apos;re not in a queue.
        </p>
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}

function ChainWalletPage() {
  const { profile, signIn } = useSession();
  const [bal, setBal] = useState<number | null>(null);
  const [history, setHistory] = useState<ArenaTxEntry[]>([]);
  const [amount, setAmount] = useState("0.005");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    setHistory(arenaHistory().slice().reverse());
    if (hasArenaWallet()) arenaBalance(CHAIN_ID).then(setBal).catch(() => {});
    else setBal(0);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (profile && hasArenaWallet()) void registerArenaAddress();
  }, [profile]);

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

  const hot = (bal ?? 0) > 0.0002;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black">
          ⚡ Arena Wallet
          {hot && (
            <span className="ml-2 rounded bg-lime-400/15 px-2 py-0.5 text-xs font-bold text-lime-300">
              HOT — instant trades
            </span>
          )}
        </h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-500">
          Your hot balance for on-chain rounds. Deposit once from your main wallet — one
          confirmation — and every pull-up, buy, and sell fires instantly with no pop-ups. The key
          lives only in this browser; withdraw back to your main wallet anytime.
        </p>
      </header>

      {!profile ? (
        <button
          onClick={() => void signIn()}
          className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Connect Wallet
        </button>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-800 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Hot balance</div>
                <div className="font-mono text-3xl font-black text-zinc-100">
                  {bal !== null ? bal.toFixed(4) : "…"}{" "}
                  <span className="text-base font-bold text-zinc-500">ETH</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-2 font-mono text-sm"
                />
                <button
                  disabled={busy !== ""}
                  onClick={() =>
                    void run("fund", async () => {
                      await fundArenaWallet(CHAIN_ID, amount);
                      playDeposit();
                    })
                  }
                  className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
                >
                  {busy === "fund" ? "Confirm in wallet…" : "Deposit"}
                </button>
                {hot && (
                  <button
                    disabled={busy !== ""}
                    onClick={() =>
                      void run("withdraw", () =>
                        arenaWithdraw(CHAIN_ID, profile.address as `0x${string}`),
                      )
                    }
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                  >
                    {busy === "withdraw" ? "Sweeping…" : "Withdraw all"}
                  </button>
                )}
              </div>
            </div>
            {hasArenaWallet() && (
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(arenaAddress());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="mt-3 font-mono text-xs text-zinc-500 hover:text-zinc-300"
                title="copy address"
              >
                {arenaAddress()} {copied ? "✓ copied" : "⧉"}
              </button>
            )}
            {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
            <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] text-zinc-600">
              Treat it like chips on the table: fund what you&apos;re actively playing with. XP,
              positions, and quests earned by this wallet credit your profile automatically.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold text-zinc-300">Transaction history</h2>
            <div className="overflow-hidden rounded-xl border border-zinc-800">
              {history.length === 0 ? (
                <div className="p-4 text-sm text-zinc-600">
                  No transactions yet — deposit and pull up to an on-chain round.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {history.map((h) => {
                      const m = KIND_META[h.kind];
                      return (
                        <tr key={h.hash + h.at} className="border-t border-zinc-800/60 first:border-t-0">
                          <td className="px-3 py-2">
                            <span className="mr-1.5">{m.icon}</span>
                            <span className={`font-bold ${m.cls}`}>{m.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {h.eth > 0 ? `${h.eth.toFixed(4)} ETH` : "—"}
                          </td>
                          <td className="hidden px-3 py-2 text-right text-xs text-zinc-500 sm:table-cell">
                            {h.via === "arena" ? "⚡ instant" : "🔏 wallet"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-zinc-500">
                            {new Date(h.at).toLocaleTimeString()}
                          </td>
                          <td className="hidden px-3 py-2 text-right md:table-cell">
                            <button
                              onClick={() => void navigator.clipboard.writeText(h.hash)}
                              className="font-mono text-xs text-zinc-600 hover:text-zinc-300"
                              title={`copy tx hash ${h.hash}`}
                            >
                              {h.hash.slice(0, 10)}…
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              History is kept in this browser (the wallet lives here too). Tap a hash to copy it.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
