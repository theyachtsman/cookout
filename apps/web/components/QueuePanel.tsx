"use client";

import { useEffect, useState } from "react";
import type { AuctionIntent, Round } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

interface Lobby {
  players: number;
  spectators: number;
  committedEth: number;
  avgEntry: number;
}

/** Lobby + batch-auction queue: submit buy intents before the queue closes. */
export function QueuePanel({
  round,
  lobby,
  preds,
  onChanged,
}: {
  round: Round;
  lobby: Lobby | null;
  preds: { moon: number; rug: number };
  onChanged: () => void;
}) {
  const { profile, signIn } = useSession();
  const [amount, setAmount] = useState("1");
  const [maxPrice, setMaxPrice] = useState("");
  const [intents, setIntents] = useState<AuctionIntent[]>([]);
  const [error, setError] = useState("");
  const [myCall, setMyCall] = useState<"moon" | "rug" | null>(null);

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
    try {
      await api(`/api/rounds/${round.id}/intents`, {
        body: {
          ethAmount: Number(amount),
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
        },
      });
      loadIntents();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cancel = async (intentId: string) => {
    try {
      await api(`/api/rounds/${round.id}/intents/${intentId}`, { method: "DELETE" });
      loadIntents();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-zinc-800 p-5 md:col-span-2">
        <h3 className="mb-1 font-black">
          {queueOpen ? "Position Queue — open" : round.state === "settling" ? "Settling…" : "Lobby"}
        </h3>
        <p className="mb-4 text-xs text-zinc-500">
          Buy intents queue until close, then everyone settles at one uniform clearing price.
          Oversubscribed? Pro-rata fills — speed buys nothing here.
        </p>
        {!profile ? (
          <button
            onClick={() => void signIn()}
            className="rounded-lg bg-amber-500 px-5 py-2 font-black text-zinc-950 hover:bg-amber-400"
          >
            Connect Wallet to Pull Up
          </button>
        ) : queueOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-500">Amount (pETH)</div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono"
              />
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
              onClick={() => void submit()}
              className="rounded-lg bg-amber-500 px-6 py-2 font-black text-zinc-950 hover:bg-amber-400"
            >
              Pull Up
            </button>
            <span className="text-xs text-zinc-500">
              balance: {profile.paperBalance.toFixed(2)} pETH
              {round.config.maxPositionEth > 0 && ` · cap ${round.config.maxPositionEth} pETH`}
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
                  {i.ethAmount} pETH{i.maxPrice ? ` @ ≤${i.maxPrice}` : " @ market"}
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
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 p-5">
          <h4 className="mb-2 text-sm font-bold text-zinc-300">Lobby</h4>
          <dl className="space-y-1 text-sm">
            <Row k="Players in queue" v={String(lobby?.players ?? 0)} />
            <Row k="Spectators" v={String(lobby?.spectators ?? 0)} />
            <Row k="Committed liquidity" v={`${(lobby?.committedEth ?? 0).toFixed(2)} pETH`} />
            <Row k="Average entry" v={`${(lobby?.avgEntry ?? 0).toFixed(2)} pETH`} />
            <Row k="Auction cap" v={`${round.config.auctionMaxRaise} pETH`} />
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
            <Row k="Seed liquidity" v={`${round.config.initialEthLiquidity} pETH`} />
            <Row k="Trade fee" v={`${round.config.tradeFeeBps / 100}%`} />
            <Row k="Auction fee" v={`${round.config.auctionFeeBps / 100}%`} />
            <Row k="Graduates at" v={`${round.config.graduationMcap} pETH mcap`} />
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
