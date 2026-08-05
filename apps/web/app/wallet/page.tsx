"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { arenaBalance, arenaWithdraw, hasArenaWallet } from "../../lib/arenaWallet";
import {
  balanceOf,
  cookoutAddress,
  cookoutBalance,
  cookoutTransfer,
  onCookoutSigner,
  signerReady,
  walletHistory,
  type WalletTxEntry,
} from "../../lib/cookoutWallet";
import type { ChainLedgerEntry, ChainLedgerKind, LedgerEntry, LedgerKind } from "@cookout/shared";
import { api } from "../../lib/api";
import { useChainOnly } from "../../lib/chainOnly";
import { fmtAmount, useDenomPref, useEthUsd } from "../../lib/ethUsd";
import { DenomToggle } from "../../components/DenomToggle";
import { ExpandableRows } from "../../components/ProfileUI";
import { BurgerWallet } from "../../components/BurgerWallet";
import { useSession } from "../../lib/session";
import { playDeposit } from "../../lib/sfx";

/** Default chain for the site-wide wallet view (Robinhood Chain Testnet). */
const CHAIN_ID = 46630;
const CHAIN_NAME = "Robinhood Chain Testnet";

/** Cookout Wallet entry types, for the on-chain History list. */
const CHAIN_META: Record<ChainLedgerKind, { icon: string; label: string }> = {
  deposit: { icon: "⬇️", label: "Deposit" },
  send: { icon: "📤", label: "Sent out" },
  pull_up: { icon: "🚪", label: "Pulled up to" },
  cancel: { icon: "↩️", label: "Cancelled pull-up" },
  claim: { icon: "🎁", label: "Claimed fill" },
  buy: { icon: "🟢", label: "Bought" },
  sell: { icon: "🔴", label: "Sold" },
  redeem: { icon: "🏦", label: "Redeemed" },
  approve: { icon: "✍️", label: "Approved" },
};

/**
 * The local log records magnitudes; the ledger wants signed amounts. This is
 * the direction each kind moves ETH, from the wallet's point of view.
 */
const LOCAL_KIND: Record<WalletTxEntry["kind"], { kind: ChainLedgerKind; sign: number }> = {
  deposit: { kind: "deposit", sign: 1 },
  withdraw: { kind: "send", sign: -1 },
  send: { kind: "send", sign: -1 },
  "pull-up": { kind: "pull_up", sign: -1 },
  cancel: { kind: "cancel", sign: 1 },
  claim: { kind: "claim", sign: 1 },
  buy: { kind: "buy", sign: -1 },
  sell: { kind: "sell", sign: 1 },
  redeem: { kind: "redeem", sign: 1 },
  approve: { kind: "approve", sign: 0 },
};

/**
 * Merge the server's mirrored history with this browser's local log.
 *
 * Both sides see the trades, but only the server knows the coin and the token
 * amounts, and only the browser sees sends and deposits made from outside the
 * site. So the server entry wins on a collision — matched on transaction hash,
 * which is the one identifier both sides agree on.
 */
function mergeHistory(
  server: ChainLedgerEntry[],
  local: WalletTxEntry[],
  sort: "recent" | "type",
): ChainLedgerEntry[] {
  const seen = new Set(server.map((e) => `${e.txHash ?? e.id}:${e.kind}`));
  const merged = [...server];
  for (const t of local) {
    const map = LOCAL_KIND[t.kind];
    if (!map || seen.has(`${t.hash}:${map.kind}`)) continue;
    seen.add(`${t.hash}:${map.kind}`);
    merged.push({
      id: `local:${t.hash}:${t.at}`,
      at: t.at,
      kind: map.kind,
      eth: t.eth * map.sign,
      chainId: t.chainId,
      txHash: t.hash,
      ...(t.to ? { peer: t.to } : {}),
    });
  }
  return merged.sort((a, b) =>
    sort === "type" ? a.kind.localeCompare(b.kind) || b.at - a.at : b.at - a.at,
  );
}

/** Cook Out balance ledger entry types (paper), for the History list. */
const LEDGER_META: Record<LedgerKind, { icon: string; label: string; credit: boolean }> = {
  stake: { icon: "⬇️", label: "Bank → Cook Out", credit: true },
  unstake: { icon: "⬆️", label: "Cook Out → Bank", credit: false },
  pull_up: { icon: "🚪", label: "Pulled up to a round", credit: false },
  refund: { icon: "↩️", label: "Fair open refund", credit: true },
  redeem: { icon: "🏦", label: "Round redemption", credit: true },
  creator_fee: { icon: "💰", label: "Creator fees", credit: true },
  jackpot: { icon: "🎰", label: "Jackpot payout", credit: true },
  buy: { icon: "🟢", label: "Bought", credit: false },
  sell: { icon: "🔴", label: "Sold", credit: true },
  pit_prediction: { icon: "🎯", label: "Pit prediction entry", credit: false },
  pit_trading: { icon: "🕹️", label: "Pit trading entry", credit: false },
  pit_reward: { icon: "🏆", label: "Pit reward", credit: true },
  pit_creator: { icon: "💠", label: "Pit creator reward", credit: true },
  pit_trial: { icon: "🔥", label: "Flame Trial entry", credit: false },
  burger_purchase: { icon: "🍔", label: "Burger purchase", credit: false },
};

export default function WalletPage() {
  const chainOnly = useChainOnly();
  if (!chainOnly) return <PaperWalletPage />;
  return <ChainWalletPage />;
}

/**
 * Paper beta: the same Cook Out balance habit, denominated in pETH. Money in the
 * bank is safe and unplayable; money at the Cook Out is what matches spend.
 */
function PaperWalletPage() {
  const { profile, promptPlayNow, refresh } = useSession();
  const peg = useEthUsd();
  const [usd, setUsd] = useDenomPref();
  const [tab, setTab] = useState<"cookout" | "burger">("cookout");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerSort, setLedgerSort] = useState<"recent" | "type">("recent");
  const sortedLedger = useMemo(() => {
    const arr = [...ledger];
    return ledgerSort === "type"
      ? arr.sort((a, b) => a.kind.localeCompare(b.kind) || b.at - a.at)
      : arr.sort((a, b) => b.at - a.at);
  }, [ledger, ledgerSort]);
  const loadLedger = useCallback(() => {
    api<{ ledger: LedgerEntry[] }>("/api/me/ledger")
      .then((d) => setLedger(d.ledger))
      .catch(() => {});
  }, []);
  useEffect(() => loadLedger(), [loadLedger]);

  if (!profile)
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <h1 className="text-2xl font-black">⚡ Cook Out Balance</h1>
        <p className="mt-2 text-sm text-zinc-500">Create your account to start playing.</p>
        <button
          onClick={promptPlayNow}
          className="mt-4 rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Play Now
        </button>
      </div>
    );

  const bank = profile.paperBalance;
  const arena = profile.arenaBalance ?? 0;

  const move = async (direction: "deposit" | "withdraw") => {
    setError("");
    setBusy(direction);
    try {
      await api<{ paperBalance: number; arenaBalance?: number }>("/api/me/arena/transfer", {
        body: { amount: Number(amount), direction },
      });
      // The server records the move in the ledger; re-fetch it (and the profile).
      loadLedger();
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
          ⚡ Cook Out Balance
          {arena > 0 && (
            <span className="ml-2 rounded bg-lime-400/15 px-2 py-0.5 text-xs font-bold text-lime-300">
              READY
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          This is your game account. Rounds spend your Cook Out balance, never your bank. It works
          exactly like the real thing will, so you build the habit here, where it&apos;s only paper.
        </p>
      </header>

      <WalletTabs tab={tab} onTab={setTab} />

      {tab === "burger" ? (
        <BurgerWallet />
      ) : (
        <>
      <PrivyWalletCard address={profile.address} />

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Balances</span>
        <DenomToggle usd={usd} onChange={setUsd} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-lime-400/[0.08] p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">At the Cook Out</div>
          <div className="mt-1 font-mono text-3xl font-black text-lime-300">
            {usd ? fmtAmount(arena, true, peg) : arena.toFixed(3)}
          </div>
          <div className="text-xs text-zinc-500">
            {usd ? `≈ ${arena.toFixed(3)} pETH · playable now` : "pETH · playable now"}
          </div>
        </div>
        <div className="rounded-2xl bg-zinc-900/40 p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">In the bank</div>
          <div className="mt-1 font-mono text-3xl font-black text-zinc-200">
            {usd ? fmtAmount(bank, true, peg) : bank.toFixed(3)}
          </div>
          <div className="text-xs text-zinc-500">
            {usd ? `≈ ${bank.toFixed(3)} pETH · safe` : "pETH · safe, can't trade"}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-900/40 p-5">
        <h2 className="mb-3 text-sm font-black text-zinc-200">Move money</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-24 rounded bg-zinc-950/60 px-3 py-2 font-mono"
          />
          <span className="text-sm text-zinc-500">pETH</span>
          <button
            disabled={busy !== ""}
            onClick={() => void move("deposit")}
            className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
          >
            {busy === "deposit" ? "…" : "Bank → Cook Out"}
          </button>
          <button
            disabled={busy !== ""}
            onClick={() => void move("withdraw")}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy === "withdraw" ? "…" : "Cook Out → Bank"}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Pull-ups spend from your Cook Out balance; round redemptions and creator fees land back in
          it (you&apos;ll see all of it in History below). Stake what you want to play with; pull the
          rest back out any time you&apos;re not in a queue.
        </p>
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
      </div>

      <div className="rounded-2xl bg-zinc-900/40 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-zinc-200">Cook Out Balance History</h2>
          <div className="flex items-center gap-1 text-xs">
            <span className="mr-1 text-zinc-600">Sort</span>
            {(["recent", "type"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setLedgerSort(k)}
                className={`rounded px-2 py-1 font-bold transition ${
                  ledgerSort === k
                    ? "bg-lime-400 text-zinc-950"
                    : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {k === "recent" ? "Recent" : "Type"}
              </button>
            ))}
          </div>
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-zinc-600">
            No moves yet. Stakes, pull-ups, buys, sells, round redemptions, and creator fees all
            show up here.
          </p>
        ) : (
          <ExpandableRows
            items={sortedLedger}
            cap={25}
            maxHeight="max-h-[36rem]"
            render={(e) => {
              const meta = LEDGER_META[e.kind];
              const credit = e.amount >= 0;
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-xl bg-zinc-950/40 px-3 py-2.5 text-sm"
                >
                  <span className="text-lg">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`font-bold ${credit ? "text-lime-300" : "text-red-400"}`}>
                      {meta.label}
                      {e.symbol &&
                        (e.roundId ? (
                          <Link
                            href={`/round/${e.roundId}`}
                            className="ml-1 text-zinc-400 hover:text-zinc-200 hover:underline"
                          >
                            ${e.symbol}
                          </Link>
                        ) : (
                          <span className="ml-1 text-zinc-500">${e.symbol}</span>
                        ))}
                    </div>
                    <div className="text-[11px] text-zinc-600">{when(e.at)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold ${credit ? "text-lime-300" : "text-red-400"}`}>
                      {credit ? "+" : "−"}
                      {usd
                        ? fmtAmount(Math.abs(e.amount), true, peg)
                        : `${Math.abs(e.amount).toFixed(3)} pETH`}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-600">
                      cook out{" "}
                      {usd ? fmtAmount(e.balanceAfter, true, peg) : `${e.balanceAfter.toFixed(2)} pETH`}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
        </>
      )}
    </div>
  );
}

/**
 * The player's Privy wallet — the real on-chain account behind their identity.
 * Shows the address (copyable) and its live native-token balance so the account
 * feels real. On the paper beta this reads ~0 until real deposits open at
 * mainnet; funding the arena from it and on-chain history are mainnet-phase.
 */
function PrivyWalletCard({ address }: { address: string }) {
  const [bal, setBal] = useState<number | null>(null);
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      balanceOf(CHAIN_ID, address)
        .then((b) => {
          if (alive) setBal(b);
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setTried(true);
        });
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  return (
    <div className="rounded-2xl bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-zinc-200">Your wallet</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Your Privy account: the real on-chain wallet behind your login.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-black text-zinc-100">
            {bal !== null ? bal.toFixed(4) : tried ? "—" : "…"}{" "}
            <span className="text-sm font-bold text-zinc-500">ETH</span>
          </div>
          <div className="text-[11px] text-zinc-600">real balance</div>
        </div>
      </div>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-3 break-all text-left font-mono text-xs text-zinc-500 hover:text-zinc-300"
        title="copy address"
      >
        {address} {copied ? "✓ copied" : "⧉"}
      </button>
      <p className="mt-3 pt-3 text-[11px] text-zinc-600">
        Depositing real ETH here and funding your Cook Out balance from it open at mainnet. The beta is paper
        money, so this stays near 0 for now.
      </p>
    </div>
  );
}

/** Compact relative time for the wallet ledger. */
function when(at: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * The Cookout Wallet — the player's Privy embedded wallet, shown as what it is.
 *
 * One address, one balance. Deposit ETH into it from anywhere, spend it on
 * every round, send it back out to any address. There is no second wallet to
 * fund into and nothing left stranded when you stop playing.
 */
function ChainWalletPage() {
  const { profile, signIn } = useSession();
  const peg = useEthUsd();
  const [usd, setUsd] = useDenomPref();
  // Burgers are off-chain progression and exist in both modes, so this page
  // carries the same two tabs as the paper one. Without them the chain-only
  // site (dev.*) had no way to reach a balance it was still awarding.
  const [tab, setTab] = useState<"cookout" | "burger">("cookout");
  const [bal, setBal] = useState<number | null>(null);
  const [local, setLocal] = useState<WalletTxEntry[]>([]);
  const [server, setServer] = useState<ChainLedgerEntry[]>([]);
  const [sort, setSort] = useState<"recent" | "type">("recent");
  const [ready, setReady] = useState(signerReady());
  const [copied, setCopied] = useState(false);

  // The embedded wallet resolves a beat after sign-in, so re-render when the
  // bridge publishes it rather than showing an empty wallet forever.
  useEffect(() => onCookoutSigner(() => setReady(signerReady())), []);

  const refresh = useCallback(() => {
    setLocal(walletHistory());
    // The mirror is the authoritative half of the history — it survives a
    // cleared browser, follows the player across devices, and knows which coin
    // a trade was in. Failure is non-fatal: the local log still renders.
    api<{ ledger: ChainLedgerEntry[] }>("/api/me/chain-ledger")
      .then((d) => setServer(d.ledger))
      .catch(() => {});
    if (signerReady()) cookoutBalance(CHAIN_ID).then(setBal).catch(() => {});
    else setBal(null);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh, ready]);

  const address = cookoutAddress() ?? profile?.address ?? "";
  const history = useMemo(() => mergeHistory(server, local, sort), [server, local, sort]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black">⚡ Cookout Wallet</h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-500">
          Your wallet on the Cook Out. Deposit ETH into it from anywhere, and every pull-up, buy,
          and sell spends straight from this balance with no pop-ups. You hold the keys through
          your login, and you can send back out to any address whenever you want.
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
          <WalletTabs tab={tab} onTab={setTab} chain />

          {tab === "burger" ? (
            <BurgerWallet />
          ) : (
            <>
              <section className="rounded-2xl bg-gradient-to-br from-lime-500/10 via-zinc-900/50 to-zinc-950 p-5 ring-1 ring-lime-400/20">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
                  Balance
                  <DenomToggle usd={usd} onChange={setUsd} native="ETH" />
                </div>
                <div className="mt-1 font-mono text-4xl font-black text-lime-300">
                  {bal !== null ? (
                    usd ? (
                      fmtAmount(bal, true, peg, "ETH", 4)
                    ) : (
                      <>
                        {bal.toFixed(4)}{" "}
                        <span className="text-lg font-bold text-zinc-500">ETH</span>
                      </>
                    )
                  ) : ready ? (
                    "…"
                  ) : (
                    "—"
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!address) return;
                    void navigator.clipboard.writeText(address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="mt-3 block break-all text-left font-mono text-xs text-zinc-500 hover:text-zinc-300"
                  title="copy your wallet address"
                >
                  {address} {copied ? "✓ copied" : "⧉"}
                </button>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  <b className="text-zinc-400">To deposit:</b> send ETH on {CHAIN_NAME} to the
                  address above — from an exchange, MetaMask, or any other wallet. It shows up here
                  as soon as the transfer confirms.
                </p>
              </section>

              <SendEth ready={ready} balance={bal ?? 0} onSent={refresh} />

              <LegacyArenaSweep to={address} onSwept={refresh} />

              <section className="rounded-2xl bg-zinc-900/40 p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black text-zinc-200">Cookout Wallet History</h2>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="mr-1 text-zinc-600">Sort</span>
                    {(["recent", "type"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setSort(k)}
                        className={`rounded px-2 py-1 font-bold transition ${
                          sort === k
                            ? "bg-lime-400 text-zinc-950"
                            : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        {k === "recent" ? "Recent" : "Type"}
                      </button>
                    ))}
                  </div>
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-zinc-600">
                    No moves yet. Deposits, pull-ups, buys, sells, claims, and sends all show up
                    here.
                  </p>
                ) : (
                  <ExpandableRows
                    items={history}
                    cap={25}
                    maxHeight="max-h-[36rem]"
                    render={(e) => {
                      const meta = CHAIN_META[e.kind];
                      const credit = e.eth > 0;
                      const zero = e.eth === 0;
                      return (
                        <div
                          key={e.id}
                          className="flex items-center gap-3 rounded-xl bg-zinc-950/40 px-3 py-2.5 text-sm"
                        >
                          <span className="text-lg">{meta.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`font-bold ${
                                zero ? "text-zinc-300" : credit ? "text-lime-300" : "text-red-400"
                              }`}
                            >
                              {meta.label}
                              {e.symbol &&
                                (e.roundId ? (
                                  <Link
                                    href={`/round/${e.roundId}`}
                                    className="ml-1 text-zinc-400 hover:text-zinc-200 hover:underline"
                                  >
                                    ${e.symbol}
                                  </Link>
                                ) : (
                                  <span className="ml-1 text-zinc-500">${e.symbol}</span>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-600">
                              <span>{when(e.at)}</span>
                              {e.peer && (
                                <span className="font-mono">
                                  → {e.peer.slice(0, 6)}…{e.peer.slice(-4)}
                                </span>
                              )}
                              {e.txHash && (
                                <button
                                  onClick={() => void navigator.clipboard.writeText(e.txHash!)}
                                  className="font-mono hover:text-zinc-300"
                                  title={`copy tx hash ${e.txHash}`}
                                >
                                  {e.txHash.slice(0, 10)}… ⧉
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={`font-mono font-bold ${
                                zero ? "text-zinc-500" : credit ? "text-lime-300" : "text-red-400"
                              }`}
                            >
                              {zero ? (
                                "—"
                              ) : (
                                <>
                                  {credit ? "+" : "−"}
                                  {usd
                                    ? fmtAmount(Math.abs(e.eth), true, peg, "ETH", 4)
                                    : `${Math.abs(e.eth).toFixed(4)} ETH`}
                                </>
                              )}
                            </div>
                            {e.tokens !== undefined && e.tokens > 0 && (
                              <div className="font-mono text-[11px] text-zinc-600">
                                {e.tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                                {e.symbol ?? "tokens"}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }}
                  />
                )}
                <p className="mt-3 text-[11px] text-zinc-600">
                  Trades are recorded by the Cook Out as they settle on-chain, so they follow you
                  between devices. Sends and outside deposits are logged by this browser.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Send ETH out of the Cookout Wallet to any address.
 *
 * "Max" is a real button rather than a hint because the fee comes out of the
 * same balance: asking to send the full amount can only ever fail, and players
 * who want the wallet empty shouldn't have to guess the gas.
 */
function SendEth({
  ready,
  balance,
  onSent,
}: {
  ready: boolean;
  balance: number;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const send = (max: boolean) => {
    setError("");
    setDone("");
    setBusy(true);
    void cookoutTransfer(CHAIN_ID, to, amount, max)
      .then((r) => {
        setDone(`Sent ${r.sent.toFixed(5)} ETH · ${r.hash.slice(0, 10)}…`);
        setAmount("");
        onSent();
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="rounded-2xl bg-zinc-900/40 p-5">
      <h2 className="text-sm font-black text-zinc-200">Send ETH</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Move funds out of your Cookout Wallet to any address on {CHAIN_NAME}.
      </p>
      <div className="mt-3 space-y-2">
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x… recipient address"
          spellCheck={false}
          className="w-full rounded-lg bg-zinc-950/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none ring-1 ring-white/5 focus:ring-lime-400/40"
        />
        <div className="flex flex-wrap gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="w-32 rounded-lg bg-zinc-950/60 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none ring-1 ring-white/5 focus:ring-lime-400/40"
          />
          <button
            disabled={busy || !ready || !to || !amount}
            onClick={() => send(false)}
            className="rounded-lg bg-lime-400 px-5 py-2.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
          <button
            disabled={busy || !ready || !to || balance <= 0}
            onClick={() => send(true)}
            title="send everything, leaving just enough for gas"
            className="rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            Send max
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      {done && <div className="mt-2 text-sm text-lime-300">{done}</div>}
      <p className="mt-3 text-[11px] text-zinc-600">
        Double-check the address — a send is final and cannot be reversed by us or anyone else.
      </p>
    </section>
  );
}

/**
 * One-time migration: earlier builds played from a burner key in localStorage.
 * Anyone who funded one still has ETH sitting in it, and it is no longer spent
 * by anything, so offer to sweep it into the Cookout Wallet. The card only
 * exists while there is something to move.
 */
function LegacyArenaSweep({ to, onSwept }: { to: string; onSwept: () => void }) {
  const [bal, setBal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasArenaWallet()) return;
    arenaBalance(CHAIN_ID)
      .then(setBal)
      .catch(() => {});
  }, []);

  if (bal <= 0.00005 || !to) return null;

  return (
    <section className="rounded-2xl bg-amber-500/[0.07] p-4 ring-1 ring-amber-400/25">
      <h2 className="text-sm font-black text-amber-200">Funds in your old session wallet</h2>
      <p className="mt-0.5 text-xs text-zinc-400">
        Earlier rounds played from a wallet stored in this browser. It holds{" "}
        <b className="font-mono text-amber-200">{bal.toFixed(5)} ETH</b> and nothing spends from it
        anymore — move it into your Cookout Wallet.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setError("");
          setBusy(true);
          void arenaWithdraw(CHAIN_ID, to as `0x${string}`)
            .then(() => {
              setBal(0);
              onSwept();
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setBusy(false));
        }}
        className="mt-3 rounded-lg bg-amber-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
      >
        {busy ? "Moving…" : "Move it over"}
      </button>
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </section>
  );
}

/**
 * Two currencies, two tabs: the money rounds spend and $BURG (earned
 * progression power). Shared so the paper and chain-only pages can never drift
 * apart again — the first tab is named for whichever wallet the site runs on.
 */
function WalletTabs({
  tab,
  onTab,
  chain,
}: {
  tab: "cookout" | "burger";
  onTab: (t: "cookout" | "burger") => void;
  chain?: boolean;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-zinc-900/60 p-1">
      {([
        { key: "cookout", label: chain ? "⚡ Cookout Wallet" : "⚡ Cook Out Balance" },
        { key: "burger", label: "🍔 Burger Balance" },
      ] as const).map((t) => (
        <button
          key={t.key}
          onClick={() => onTab(t.key)}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-black transition ${
            tab === t.key
              ? t.key === "burger"
                ? "bg-amber-400 text-zinc-950"
                : "bg-lime-400 text-zinc-950"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
