"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  PIT_DURATION_MAP,
  marketCap,
  spotPrice,
  type Candle,
  type KillFeedEvent,
  type PitCall,
  type PitEntry,
  type Round,
  type RoundSummary,
  type Trade,
} from "@cookout/shared";
import { api } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { useSocial } from "../../../lib/social";
import { useRoundSocket } from "../../../lib/useRoundSocket";
import { Chart } from "../../../components/Chart";
import { OrderBook } from "../../../components/OrderBook";
import { GraduationProgress } from "../../../components/GraduationProgress";
import { Countdown } from "../../../components/Countdown";
import { pdotEth } from "../../../lib/pit";
import { PitResultsView } from "../../../components/PitResults";

interface RoundData {
  round: Round;
  killfeed: KillFeedEvent[];
  trades: Trade[];
  candles: Candle[];
  summary: RoundSummary | null;
  ethUsd: number;
}

const CALLS: { key: PitCall; label: string; icon: string; blurb: string }[] = [
  { key: "graduate", label: "Graduate", icon: "🍽️", blurb: "It bonds and serves up" },
  { key: "rug", label: "Rug", icon: "🔻", blurb: "The Swarm pulls the market" },
  { key: "timer", label: "Timer", icon: "⏱️", blurb: "It runs the clock out" },
];

export default function PitMatchPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, signIn } = useSession();
  const { setActiveRoom } = useSocial();
  const me = profile?.address?.toLowerCase();

  const [data, setData] = useState<RoundData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ticker, setTicker] = useState<{ price: number; mcap: number; volume: number; holders: number } | null>(null);
  const [feed, setFeed] = useState<{ id: string; text: string }[]>([]);
  const [entry, setEntry] = useState<PitEntry | null>(null);
  const [stack, setStack] = useState(0);
  const seenFeed = useRef(new Set<string>());

  const round = data?.round;
  const pit = round?.pit;

  const loadRound = useCallback(() => {
    api<RoundData>(`/api/rounds/${id}`)
      .then((d) => {
        setData(d);
        setTrades(d.trades);
        setCandles(d.candles);
      })
      .catch(() => {});
  }, [id]);

  const loadMe = useCallback(() => {
    if (!profile) return;
    api<{ entry: PitEntry | null; stack: number }>(`/api/pit/${id}/me`)
      .then((d) => {
        setEntry(d.entry);
        setStack(d.stack);
      })
      .catch(() => {});
  }, [id, profile]);

  useEffect(() => {
    loadRound();
    loadMe();
  }, [loadRound, loadMe]);

  // Poll while in lobby (pools + state); the socket carries the live match.
  useEffect(() => {
    if (round && round.state !== "lobby") return;
    const t = setInterval(() => {
      loadRound();
    }, 3000);
    return () => clearInterval(t);
  }, [round, loadRound]);

  useRoundSocket(id ?? null, (ev) => {
    if (ev.type === "ticker") {
      setTicker({
        price: ev.price as number,
        mcap: ev.mcap as number,
        volume: ev.volume as number,
        holders: ev.holders as number,
      });
    } else if (ev.type === "trade") {
      setTrades((t) => [...t, ev.trade as Trade].slice(-200));
    } else if (ev.type === "candle") {
      setCandles((c) => [...c, ev.candle as Candle].slice(-1200));
    } else if (ev.type === "round_state") {
      setData((d) => (d ? { ...d, round: ev.round as Round } : d));
    } else if (ev.type === "round_end") {
      setData((d) => (d ? { ...d, round: { ...d.round, state: "results" }, summary: ev.summary as RoundSummary } : d));
    } else if (ev.type === "chat") {
      const m = ev.message as { id: string; system?: boolean; systemKind?: string; text: string };
      if (m.system && m.systemKind?.startsWith("pit_") && !seenFeed.current.has(m.id)) {
        seenFeed.current.add(m.id);
        setFeed((f) => [{ id: m.id, text: m.text }, ...f].slice(0, 8));
      }
    } else if (ev.type === "killfeed") {
      const k = ev.event as KillFeedEvent;
      if (!seenFeed.current.has(k.id)) {
        seenFeed.current.add(k.id);
        setFeed((f) => [{ id: k.id, text: k.text }, ...f].slice(0, 8));
      }
    }
  });

  // Reload my stack/entry when a match goes live (stack is handed out at entry).
  useEffect(() => {
    if (round?.state === "live") loadMe();
  }, [round?.state, loadMe]);

  // The Grill dock follows you into the Pit match's own chat room.
  useEffect(() => {
    if (!round) return;
    setActiveRoom({
      id: round.id,
      label: `$${round.token.symbol}`,
      frozen: round.state === "results" || round.state === "ended",
    });
  }, [round?.id, round?.state, round?.token.symbol, setActiveRoom]);
  useEffect(() => () => setActiveRoom(null), [setActiveRoom]);

  const myPos = useMemo(() => {
    if (!me) return { tokens: 0 };
    let tokens = 0;
    for (const t of trades)
      if (t.userAddress.toLowerCase() === me) tokens += t.side === "buy" ? t.tokenAmount : -t.tokenAmount;
    return { tokens: Math.max(0, tokens) };
  }, [trades, me]);

  if (!round) return <div className="py-24 text-center text-zinc-600">Loading The Pit…</div>;

  const d = PIT_DURATION_MAP[pit?.duration ?? "standard"];
  const price = ticker?.price ?? (round.pool ? spotPrice(round.pool) : 0);
  const mcap = ticker?.mcap ?? (round.pool ? marketCap(round.pool) : 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/pit" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← The Pit
        </Link>
        <h1 className="text-xl font-black text-zinc-50">
          {round.token.name} <span className="font-mono text-sm text-zinc-500">${round.token.symbol}</span>
        </h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[11px] font-bold text-fuchsia-300">
          {d.icon} {d.name}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-fuchsia-300/70">Powered by Swarm AI</span>
        {round.state === "live" && round.endsAt && (
          <span className="ml-auto font-mono text-lg font-black text-lime-300">
            <Countdown to={round.endsAt} />
          </span>
        )}
      </div>

      {round.state === "lobby" && (
        <LobbyView
          round={round}
          entry={entry}
          stack={stack}
          signedIn={!!profile}
          onSignIn={signIn}
          onEntered={() => {
            loadMe();
            loadRound();
          }}
        />
      )}

      {round.state === "live" && (
        <LiveView
          round={round}
          trades={trades}
          candles={candles}
          price={price}
          mcap={mcap}
          volume={ticker?.volume ?? 0}
          holders={ticker?.holders ?? 0}
          ethUsd={data.ethUsd}
          me={me}
          entry={entry}
          stack={stack}
          myTokens={myPos.tokens}
          feed={feed}
          onTraded={loadMe}
        />
      )}

      {round.state === "results" && (
        <PitResultsView round={round} summary={data.summary} me={me} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Pools({ round }: { round: Round }) {
  const pit = round.pit!;
  const pred = pit.prediction.pot + pit.prediction.carryIn;
  const trade = pit.trading.pot + pit.trading.carryIn;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
        <div className="text-xs text-zinc-500">Prediction pool</div>
        <div className="font-mono text-xl font-black text-zinc-50">{pdotEth(pred)}</div>
        <div className="text-[11px] text-zinc-600">
          {pit.prediction.participants} in
          {pit.prediction.carryIn > 1e-9 && (
            <span className="ml-1 text-amber-300">· carry {pdotEth(pit.prediction.carryIn)}</span>
          )}
        </div>
      </div>
      <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
        <div className="text-xs text-zinc-500">Trading pool</div>
        <div className="font-mono text-xl font-black text-zinc-50">{pdotEth(trade)}</div>
        <div className="text-[11px] text-zinc-600">
          {pit.trading.participants} in
          {pit.trading.carryIn > 1e-9 && (
            <span className="ml-1 text-amber-300">· carry {pdotEth(pit.trading.carryIn)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LobbyView({
  round,
  entry,
  stack,
  signedIn,
  onSignIn,
  onEntered,
}: {
  round: Round;
  entry: PitEntry | null;
  stack: number;
  signedIn: boolean;
  onSignIn: () => void;
  onEntered: () => void;
}) {
  const pit = round.pit!;
  const [call, setCall] = useState<PitCall | null>(null);
  const [trading, setTrading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cost = (call ? pit.predictionFee : 0) + (trading ? pit.tradingFee : 0);

  const submit = async () => {
    setError("");
    if (!call && !trading) {
      setError("Pick a prediction, the trading pool, or both.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/pit/${round.id}/enter`, {
        body: { prediction: call ?? undefined, trading },
      });
      onEntered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-amber-500/[0.06] p-3 text-sm ring-1 ring-amber-500/20">
        <span className="font-bold text-amber-200">Lobby open. Enter before it goes live.</span>
        {round.queueOpensAt && (
          <span className="font-mono font-black text-amber-200">
            <Countdown to={round.queueOpensAt} />
          </span>
        )}
      </div>

      <Pools round={round} />

      {entry ? (
        <div className="rounded-2xl bg-lime-500/[0.06] p-4 ring-1 ring-lime-500/20">
          <div className="text-sm font-black text-lime-300">You&apos;re in.</div>
          <div className="mt-1 text-sm text-zinc-300">
            {entry.prediction && (
              <span className="mr-3">
                Prediction: <b className="capitalize">{entry.prediction}</b>
              </span>
            )}
            {entry.trading && (
              <span>
                Trading stack: <b className="font-mono">{pdotEth(stack)}</b>
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Trading goes live when the lobby closes. The Swarm is warming up.
          </p>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
              Prediction pool · {pdotEth(pit.predictionFee)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CALLS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCall(call === c.key ? null : c.key)}
                  className={`rounded-xl p-3 text-center ring-1 transition ${
                    call === c.key
                      ? "bg-fuchsia-500/15 ring-fuchsia-400/50"
                      : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                  }`}
                >
                  <div className="text-2xl">{c.icon}</div>
                  <div className="mt-1 text-sm font-black text-zinc-100">{c.label}</div>
                  <div className="text-[10px] text-zinc-500">{c.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
            <input
              type="checkbox"
              checked={trading}
              onChange={(e) => setTrading(e.target.checked)}
              className="h-4 w-4 accent-fuchsia-500"
            />
            <span className="flex-1">
              <span className="text-sm font-black text-zinc-100">Trading pool · {pdotEth(pit.tradingFee)}</span>
              <span className="block text-[11px] text-zinc-500">
                Get a {pdotEth(pit.startingStack)} paper stack and trade the Swarm. Finish in profit to qualify.
              </span>
            </span>
          </label>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {signedIn ? (
            <button
              onClick={submit}
              disabled={busy || cost === 0}
              className="w-full rounded-xl bg-fuchsia-500 py-3 text-sm font-black text-zinc-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
            >
              {busy ? "Entering…" : cost > 0 ? `Enter · ${pdotEth(cost)}` : "Pick at least one pool"}
            </button>
          ) : (
            <button
              onClick={onSignIn}
              className="w-full rounded-xl bg-lime-400 py-3 text-sm font-black text-zinc-950 hover:bg-lime-300"
            >
              Sign in to enter The Pit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LiveView({
  round,
  trades,
  candles,
  price,
  mcap,
  volume,
  holders,
  ethUsd,
  me,
  entry,
  stack,
  myTokens,
  feed,
  onTraded,
}: {
  round: Round;
  trades: Trade[];
  candles: Candle[];
  price: number;
  mcap: number;
  volume: number;
  holders: number;
  ethUsd: number;
  me?: string;
  entry: PitEntry | null;
  stack: number;
  myTokens: number;
  feed: { id: string; text: string }[];
  onTraded: () => void;
}) {
  const pnl = entry?.trading ? stack + myTokens * price - round.pit!.startingStack : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="rounded-2xl bg-zinc-900/50 p-2 ring-1 ring-white/10">
          <Chart
            candles={candles}
            trades={trades}
            livePrice={price}
            supply={round.config.totalSupply}
            ethUsd={ethUsd}
            liveAt={round.liveAt}
            liquidity={round.pool?.ethReserve}
            highlightAddress={me}
          />
        </div>
        <GraduationProgress config={round.config} ticker={{ mcap, volume, holders, ethUsd }} />
        <OrderBook trades={trades} symbol={round.token.symbol} ethUsd={ethUsd} me={me} />
      </div>

      <div className="space-y-4">
        <Pools round={round} />

        {entry?.trading ? (
          <StackTrade round={round} stack={stack} tokens={myTokens} pnl={pnl} onTraded={onTraded} />
        ) : (
          <div className="rounded-2xl bg-zinc-900/50 p-4 text-sm text-zinc-400 ring-1 ring-white/10">
            {entry?.prediction ? (
              <>
                You called <b className="capitalize text-zinc-100">{entry.prediction}</b>. Watch the Swarm
                and see if it lands.
              </>
            ) : (
              "You're spectating. Trading entry closed at the bell."
            )}
          </div>
        )}

        {/* Swarm feed */}
        <div className="rounded-2xl bg-zinc-900/50 p-3 ring-1 ring-white/10">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-fuchsia-300">
            Swarm AI
          </div>
          <div className="space-y-1.5">
            {feed.length === 0 ? (
              <div className="text-xs text-zinc-600">The Swarm is reading the tape…</div>
            ) : (
              feed.map((f) => (
                <div key={f.id} className="text-xs text-zinc-300">
                  {f.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StackTrade({
  round,
  stack,
  tokens,
  pnl,
  onTraded,
}: {
  round: Round;
  stack: number;
  tokens: number;
  pnl: number;
  onTraded: () => void;
}) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (body: Record<string, unknown>) => {
    setError("");
    setBusy(true);
    try {
      await api(`/api/rounds/${round.id}/trade`, { body });
      setAmount("");
      onTraded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-900/50 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-zinc-500">
          Stack <b className="font-mono text-zinc-100">{pdotEth(stack)}</b>
        </span>
        <span className={pnl >= 0 ? "text-lime-300" : "text-red-400"}>
          PnL {pnl >= 0 ? "+" : ""}
          {pnl.toFixed(3)}
        </span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-zinc-950/60 p-1">
        {(["buy", "sell"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md py-1.5 text-sm font-black uppercase ${
              tab === t
                ? t === "buy"
                  ? "bg-lime-500 text-zinc-950"
                  : "bg-red-500 text-white"
                : "text-zinc-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "buy" ? (
        <>
          <div className="flex flex-wrap gap-1">
            {[0.1, 0.25, 0.5].map((a) => (
              <button
                key={a}
                onClick={() => setAmount(String(a))}
                className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
              >
                {a}
              </button>
            ))}
            <button
              onClick={() => setAmount(stack.toFixed(3))}
              className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
            >
              Max
            </button>
          </div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="pETH from your stack"
            className="mt-2 w-full rounded-lg bg-zinc-950/60 px-3 py-2 text-center font-mono text-lg outline-none ring-1 ring-white/10 focus:ring-lime-400/50"
          />
          <button
            onClick={() => act({ side: "buy", eth: Number(amount) })}
            disabled={busy || !(Number(amount) > 0)}
            className="mt-2 w-full rounded-lg bg-lime-500 py-2.5 text-sm font-black text-zinc-950 hover:bg-lime-400 disabled:opacity-40"
          >
            Buy
          </button>
        </>
      ) : (
        <>
          <div className="mb-1 text-center text-xs text-zinc-500">
            Holding <b className="font-mono text-zinc-200">{tokens.toFixed(0)}</b> {round.token.symbol}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => act({ side: "sell", pct: p })}
                disabled={busy || tokens <= 0}
                className="rounded-lg bg-red-500/90 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-40"
              >
                {p}%
              </button>
            ))}
          </div>
        </>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}
