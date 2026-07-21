"use client";

import { useEffect, useRef, useState } from "react";
import type { AuctionIntent, Round } from "@cookout/shared";
import { api } from "../lib/api";
import { chainCancelIntent, chainSubmitIntent, walletEthBalance } from "../lib/chainTx";
import { useSession } from "../lib/session";
import { useSocial } from "../lib/social";
import { STATUS_META, UserName } from "./UserCard";
import { playDeposit, playPullupNote } from "../lib/sfx";

interface Lobby {
  players: number;
  spectators: number;
  committedEth: number;
  avgEntry: number;
}

interface Bid {
  userAddress: string;
  displayName?: string;
  avatarUrl?: string;
  ethAmount: number;
  limit: boolean;
  at: number;
}

/** Lobby + batch-auction queue: submit buy intents before the queue closes. */
export function QueuePanel({
  round,
  lobby,
  preds,
  ethUsd,
  onChanged,
}: {
  round: Round;
  lobby: Lobby | null;
  preds: { moon: number; rug: number };
  /** Live ETH/USD peg — enables entering the deposit in dollars. */
  ethUsd?: number;
  onChanged: () => void;
}) {
  const { profile, signIn } = useSession();
  const { online } = useSocial();
  const onChain = !!round.chain;
  const unit = onChain ? "ETH" : "pETH";
  const [amount, setAmount] = useState(onChain ? "0.001" : "0.1");
  // Pull up in native units or dollars — converted at the live peg.
  const [denom, setDenom] = useState<"native" | "usd">("native");
  const peg = ethUsd && ethUsd > 0 ? ethUsd : 0;
  const [maxPrice, setMaxPrice] = useState("");
  const [intents, setIntents] = useState<AuctionIntent[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [myCall, setMyCall] = useState<"moon" | "rug" | null>(null);

  // Chain rounds escrow real ETH from the wallet — show that balance instead.
  const [ethBal, setEthBal] = useState<number | null>(null);
  useEffect(() => {
    if (!onChain || !profile) return;
    walletEthBalance(round.chain?.chainId).then(setEthBal).catch(() => {});
  }, [onChain, profile, intents.length]);

  // Live pre-position board: everyone's bids, refreshed while the queue runs.
  // Every NEW pull-up gets a harmonic ping so a filling queue literally sings.
  const bidCount = useRef(-1);
  useEffect(() => {
    if (round.state !== "queue_open" && round.state !== "lobby") return;
    let alive = true;
    const poll = () =>
      api<{ bids?: Bid[] }>(`/api/rounds/${round.id}/intents`)
        .then((d) => {
          if (!alive || !d.bids) return;
          // Each new pull-up plays the next note of the lobby riff; a burst
          // of arrivals staggers into a run so the beat stays musical.
          if (bidCount.current >= 0 && d.bids.length > bidCount.current) {
            const from = bidCount.current;
            for (let i = from; i < Math.min(d.bids.length, from + 6); i++) {
              setTimeout(() => playPullupNote(i), (i - from) * 140);
            }
          }
          bidCount.current = d.bids.length;
          setBids(d.bids);
        })
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [round.id, round.state]);

  const loadIntents = () => {
    if (!profile) return;
    api<{ intents: AuctionIntent[]; prediction: "moon" | "rug" | null }>(
      `/api/rounds/${round.id}/me`,
    )
      .then((d) => {
        setIntents(d.intents);
        setMyCall(d.prediction);
      })
      .catch(() => {});
  };
  useEffect(loadIntents, [round.id, round.state, profile]);

  const submit = async () => {
    setError("");
    setPending(true);
    try {
      const typed = Number(amount);
      if (!(typed > 0)) throw new Error("enter an amount");
      // USD entry converts at the live peg before it ever leaves the client.
      const ethAmount = denom === "usd" && peg ? typed / peg : typed;
      if (onChain) {
        // Real ETH escrows into the round's auction contract; the server
        // mirrors the IntentSubmitted event into the board a tick later.
        await chainSubmitIntent(
          round,
          ethAmount.toFixed(18).replace(/0+$/, "") || String(ethAmount),
          maxPrice || undefined,
        );
      } else {
        await api(`/api/rounds/${round.id}/intents`, {
          body: {
            ethAmount,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
          },
        });
      }
      playDeposit();
      loadIntents();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const cancel = async (intentId: string) => {
    setPending(true);
    try {
      if (onChain) await chainCancelIntent(round, intentId);
      else await api(`/api/rounds/${round.id}/intents/${intentId}`, { method: "DELETE" });
      loadIntents();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const predict = async (call: "moon" | "rug") => {
    try {
      await api(`/api/rounds/${round.id}/predict`, { body: { call } });
      setMyCall(call);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const queueOpen = round.state === "queue_open";
  // Who's standing in this specific match room right now.
  const inRoom = online.filter((u) => u.roundId === round.id);
  const largestEntry = bids.reduce((m, b) => Math.max(m, b.ethAmount), 0);
  const usdMode = denom === "usd" && peg > 0;
  const typedNum = Number(amount);
  const convertedHint =
    peg && typedNum > 0
      ? usdMode
        ? `≈ ${(typedNum / peg).toFixed(onChain ? 5 : 4)} ${unit}`
        : `≈ $${(typedNum * peg).toFixed(2)}`
      : "";

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="flex flex-col rounded-xl border border-zinc-800 p-5 md:col-span-2">
        <h3 className="mb-1 font-black">
          {queueOpen ? "Position Queue — open" : round.state === "settling" ? "Settling…" : "Lobby"}
          {onChain && (
            <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              ⛓️ ON-CHAIN · real testnet ETH
            </span>
          )}
        </h3>
        <p className="mb-4 text-xs text-zinc-500">
          Buy intents queue until close, then everyone settles at one uniform clearing price.
          Oversubscribed? Pro-rata fills — speed buys nothing here.
          {onChain && " Your ETH escrows in the round's auction contract until settlement."}
        </p>
        {!profile ? (
          <button
            onClick={() => void signIn()}
            className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
          >
            Connect Wallet to Pull Up
          </button>
        ) : queueOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                <span>Amount</span>
                {peg > 0 && (
                  <span className="flex overflow-hidden rounded-full border border-zinc-800 text-[10px] font-bold">
                    {(
                      [
                        ["native", unit],
                        ["usd", "USD"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          const n = Number(amount);
                          if (n > 0)
                            setAmount(
                              key === "usd"
                                ? (n * peg).toFixed(2)
                                : (n / peg).toFixed(onChain ? 5 : 4),
                            );
                          setDenom(key);
                        }}
                        className={`px-2 py-0.5 ${
                          denom === key
                            ? "bg-zinc-700 text-zinc-100"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {usdMode && <span className="font-mono text-zinc-500">$</span>}
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono"
                />
              </div>
              {convertedHint && (
                <div className="mt-1 font-mono text-[11px] text-zinc-500">{convertedHint}</div>
              )}
            </label>
            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-500">Max price (optional)</div>
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="market"
                className="w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono"
              />
            </label>
            <button
              disabled={pending}
              onClick={() => void submit()}
              className="rounded-lg bg-lime-400 px-6 py-2 font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
            >
              {pending ? "Confirm in wallet…" : "Pull Up"}
            </button>
            <span className="text-xs text-zinc-500">
              balance:{" "}
              {onChain
                ? `${ethBal !== null ? ethBal.toFixed(4) : "…"} ${unit}`
                : `${(profile.arenaBalance ?? 0).toFixed(2)} ${unit}`}
              {round.config.maxPositionEth > 0 && ` · cap ${round.config.maxPositionEth} ${unit}`}
            </span>
          </div>
        ) : (
          <div className="text-sm text-zinc-400">
            {round.state === "lobby"
              ? "Queue opens soon — hang tight."
              : "Queue closed. Clearing price being computed…"}
          </div>
        )}
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
        {intents.length > 0 && (
          <div className="mt-4 space-y-1">
            {intents.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between rounded bg-zinc-900 px-3 py-1.5 text-sm"
              >
                <span className="font-mono">
                  {i.ethAmount} {unit}{i.maxPrice ? ` @ ≤${i.maxPrice}` : " @ market"}
                </span>
                {queueOpen && (
                  <button
                    onClick={() => void cancel(i.id)}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-1 flex-col border-t border-zinc-800 pt-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-bold text-zinc-300">Live pre-positions</span>
            <span className="font-mono text-zinc-500">
              {bids.length} bids · {bids.reduce((s, b) => s + b.ethAmount, 0).toFixed(2)} {unit}
            </span>
          </div>
          <div className="flex min-h-56 flex-1 flex-col-reverse gap-1 overflow-y-auto">
            {[...bids]
              .sort((a, b) => a.at - b.at)
              .reverse()
              .map((b, i) => (
                <div
                  key={`${b.userAddress}-${b.at}-${i}`}
                  className="killfeed-item flex items-center gap-2 rounded bg-zinc-900 px-2 py-1 text-sm"
                >
                  {b.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px]">
                      {(b.displayName ?? b.userAddress.slice(2, 4)).slice(0, 2)}
                    </span>
                  )}
                  <a href={`/profile/${b.userAddress}`} className="truncate hover:underline">
                    {b.displayName ?? `${b.userAddress.slice(0, 6)}…${b.userAddress.slice(-4)}`}
                  </a>
                  <span className="ml-auto font-mono text-lime-300">
                    {b.ethAmount.toFixed(2)} {unit}
                  </span>
                  {b.limit && <span className="text-[10px] text-zinc-500">limit</span>}
                </div>
              ))}
            {bids.length === 0 && (
              <div className="text-xs text-zinc-600">no bids yet — be first in</div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 p-5">
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-sm font-bold text-zinc-300">In the room</h4>
            <span className="font-mono text-xs text-lime-300">{inRoom.length}</span>
          </div>
          {/* Players gathering before the game — faces, not a count. */}
          <div className="mb-3 max-h-40 space-y-0.5 overflow-y-auto">
            {inRoom.length === 0 && (
              <div className="text-xs text-zinc-600">nobody here yet — be the first</div>
            )}
            {inRoom.map((u) => {
              const meta = STATUS_META[u.status];
              return (
                <div key={u.address} className="flex items-center gap-2 rounded px-1 py-0.5">
                  {u.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-bold text-zinc-400">
                      {(u.displayName ?? u.address.slice(2, 4)).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <UserName
                    address={u.address}
                    name={u.displayName}
                    badge={u.badge}
                    className="min-w-0 flex-1 text-left text-xs text-zinc-300"
                  />
                  <span className={`shrink-0 text-[10px] ${meta.cls}`} title={meta.label}>
                    {meta.dot}
                  </span>
                </div>
              );
            })}
          </div>
          <dl className="space-y-1 border-t border-zinc-800 pt-2 text-sm">
            <Row k="Players ready" v={String(lobby?.players ?? 0)} />
            <Row k="Spectators" v={String(lobby?.spectators ?? 0)} />
            <Row k="Committed" v={`${(lobby?.committedEth ?? 0).toFixed(2)} ${unit}`} />
            <Row k="Average entry" v={`${(lobby?.avgEntry ?? 0).toFixed(2)} ${unit}`} />
            <Row k="Largest entry" v={`${largestEntry.toFixed(2)} ${unit}`} />
            <Row k="Auction cap" v={`${round.config.auctionMaxRaise} ${unit}`} />
          </dl>
        </div>
        <div className="rounded-xl border border-zinc-800 p-5">
          <h4 className="mb-2 text-sm font-bold text-zinc-300">Moon or Rug?</h4>
          <p className="mb-2 text-xs text-zinc-500">Call it before the open. Correct calls earn XP.</p>
          <div className="flex gap-2">
            <button
              disabled={!!myCall || !profile}
              onClick={() => void predict("moon")}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-bold text-emerald-300 disabled:opacity-40 ${
                myCall === "moon"
                  ? "bg-emerald-600/50 ring-1 ring-emerald-400 !opacity-100"
                  : "bg-emerald-600/20 hover:bg-emerald-600/40"
              }`}
            >
              🌕 Moon ({preds.moon})
            </button>
            <button
              disabled={!!myCall || !profile}
              onClick={() => void predict("rug")}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-bold text-red-300 disabled:opacity-40 ${
                myCall === "rug"
                  ? "bg-red-600/50 ring-1 ring-red-400 !opacity-100"
                  : "bg-red-600/20 hover:bg-red-600/40"
              }`}
            >
              🧨 Rug ({preds.rug})
            </button>
          </div>
          {myCall && (
            <p className="mt-2 text-xs font-bold text-zinc-300">
              You called {myCall === "moon" ? "🌕 Moon" : "🧨 Rug"} — locked in.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 p-5">
          <h4 className="mb-2 text-sm font-bold text-zinc-300">Tokenomics</h4>
          <dl className="space-y-1 text-sm">
            <Row k="Total supply" v={round.config.totalSupply.toLocaleString()} />
            <Row k="Pool at open" v={round.config.initialTokenLiquidity.toLocaleString()} />
            <Row k="Seed liquidity" v={`${round.config.initialEthLiquidity} ${unit}`} />
            <Row k="Trade fee" v={`${round.config.tradeFeeBps / 100}%`} />
            <Row k="Auction fee" v={`${round.config.auctionFeeBps / 100}%`} />
            <Row
              k="Serves up at"
              v={
                onChain
                  ? `${round.config.graduationMcap.toFixed(4)} ${unit} mcap`
                  : `$40,000 mcap (≈${round.config.graduationMcap.toFixed(1)} ${unit})`
              }
            />
            <Row
              k="Dev sell lock"
              v={round.config.devSellLockSeconds > 0 ? `${round.config.devSellLockSeconds}s after open` : "none — degen rules"}
            />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="font-mono">{v}</dd>
    </div>
  );
}
