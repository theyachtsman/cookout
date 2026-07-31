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
import { TradePanel } from "../../../components/TradePanel";
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
          ethUsd={data.ethUsd}
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
  ethUsd,
  signedIn,
  onSignIn,
  onEntered,
}: {
  round: Round;
  entry: PitEntry | null;
  stack: number;
  ethUsd: number;
  signedIn: boolean;
  onSignIn: () => void;
  onEntered: () => void;
}) {
  const pit = round.pit!;
  const peg = ethUsd > 0 ? ethUsd : 1;
  const [call, setCall] = useState<PitCall | null>(null);
  const [trading, setTrading] = useState(false);
  // Bets in USD (min $1). Sensible defaults; the player can change either.
  const [betUsd, setBetUsd] = useState<string>("5");
  const [tradeBetUsd, setTradeBetUsd] = useState<string>("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const armed = !!round.queueOpensAt;
  const predCount = pit.prediction.participants;
  const bet = Math.max(0, Number(betUsd) || 0);
  const stakeEth = bet / peg;
  const tradeBet = Math.max(0, Number(tradeBetUsd) || 0);
  const tradeStakeEth = tradeBet / peg;
  const cost = (call ? stakeEth : 0) + (trading ? tradeStakeEth : 0);

  const submit = async () => {
    setError("");
    if (!call && !trading) {
      setError("Pick a prediction, join trading, or both.");
      return;
    }
    if (call && bet < 1) {
      setError("Minimum prediction bet is $1.");
      return;
    }
    if (trading && tradeBet < 1) {
      setError("Minimum trading buy-in is $1.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/pit/${round.id}/enter`, {
        body: {
          prediction: call ?? undefined,
          predictionStake: call ? stakeEth : undefined,
          trading,
          tradingStake: trading ? tradeStakeEth : undefined,
        },
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
      {/* Status: waiting for quorum, or armed countdown. */}
      <div
        className={`flex items-center justify-between rounded-2xl p-3 text-sm ring-1 ${
          armed ? "bg-fuchsia-500/[0.06] ring-fuchsia-500/25" : "bg-amber-500/[0.06] ring-amber-500/20"
        }`}
      >
        {armed && round.queueOpensAt ? (
          <>
            <span className="font-bold text-fuchsia-200">Quorum reached. Goes live soon.</span>
            <span className="font-mono font-black text-fuchsia-200">
              <Countdown to={round.queueOpensAt} />
            </span>
          </>
        ) : (
          <>
            <span className="font-bold text-amber-200">
              Waiting on {Math.max(0, 2 - predCount)} more prediction{2 - predCount === 1 ? "" : "s"} to start.
            </span>
            <span className="font-mono font-black text-amber-200">{predCount}/2</span>
          </>
        )}
      </div>

      <Pools round={round} />

      {entry ? (
        <div className="rounded-2xl bg-lime-500/[0.06] p-4 ring-1 ring-lime-500/20">
          <div className="text-sm font-black text-lime-300">You&apos;re in.</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300">
            {entry.prediction && (
              <span>
                Called <b className="capitalize">{entry.prediction}</b>
                {entry.predictionStake ? (
                  <b className="ml-1 font-mono text-zinc-400">· {pdotEth(entry.predictionStake)}</b>
                ) : null}
              </span>
            )}
            {entry.trading && (
              <span>
                Trading stack <b className="font-mono">{pdotEth(stack)}</b>
                {entry.tradingStake ? (
                  <b className="ml-1 font-mono text-zinc-400">· bet {pdotEth(entry.tradingStake)}</b>
                ) : null}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {armed ? "The Swarm is warming up. Trading opens at the bell." : "Two bets arm the countdown."}
          </p>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl bg-zinc-900/40 p-4 ring-1 ring-white/10">
          {/* Prediction — button driven, with a custom bet. */}
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Prediction pool</div>
            <div className="grid grid-cols-3 gap-2">
              {CALLS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCall(call === c.key ? null : c.key)}
                  className={`rounded-xl p-3 text-center ring-1 transition ${
                    call === c.key
                      ? "bg-fuchsia-500/15 ring-fuchsia-400/60"
                      : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                  }`}
                >
                  <div className="text-2xl">{c.icon}</div>
                  <div className="mt-1 text-sm font-black text-zinc-100">{c.label}</div>
                  <div className="text-[10px] text-zinc-500">{c.blurb}</div>
                </button>
              ))}
            </div>
            {call && (
              <div className="mt-2 rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500">
                  <span>Your bet (min $1)</span>
                  <span className="font-mono text-zinc-400">≈ {pdotEth(stakeEth, 3)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center rounded-lg bg-zinc-950/60 px-3 ring-1 ring-white/10 focus-within:ring-fuchsia-400/50">
                    <span className="text-zinc-500">$</span>
                    <input
                      value={betUsd}
                      onChange={(e) => setBetUsd(e.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      className="w-full bg-transparent px-1 py-2 text-center font-mono text-lg outline-none"
                    />
                  </div>
                  {[1, 5, 25].map((v) => (
                    <button
                      key={v}
                      onClick={() => setBetUsd(String(v))}
                      className="rounded-lg bg-zinc-800 px-2.5 py-2 text-xs font-bold hover:bg-zinc-700"
                    >
                      ${v}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  Parimutuel: correct callers split the pool pro-rata to their bet.
                </p>
              </div>
            )}
          </div>

          {/* Trading — button toggle (no checkbox) + custom parimutuel buy-in. */}
          <div>
            <button
              onClick={() => setTrading((t) => !t)}
              className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition ${
                trading ? "bg-lime-500/15 ring-lime-400/50" : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  trading ? "bg-lime-400 text-zinc-950" : "bg-zinc-700 text-zinc-300"
                }`}
              >
                {trading ? "✓" : "+"}
              </span>
              <span className="flex-1">
                <span className="text-sm font-black text-zinc-100">Join trading pool</span>
                <span className="block text-[11px] text-zinc-500">
                  Trade a {pdotEth(pit.startingStack)} paper stack against the Swarm. Finish in profit to qualify.
                </span>
              </span>
            </button>
            {trading && (
              <div className="mt-2 rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
                <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500">
                  <span>Your buy-in (min $1)</span>
                  <span className="font-mono text-zinc-400">≈ {pdotEth(tradeStakeEth, 3)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center rounded-lg bg-zinc-950/60 px-3 ring-1 ring-white/10 focus-within:ring-lime-400/50">
                    <span className="text-zinc-500">$</span>
                    <input
                      value={tradeBetUsd}
                      onChange={(e) => setTradeBetUsd(e.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      className="w-full bg-transparent px-1 py-2 text-center font-mono text-lg outline-none"
                    />
                  </div>
                  {[1, 5, 25].map((v) => (
                    <button
                      key={v}
                      onClick={() => setTradeBetUsd(String(v))}
                      className="rounded-lg bg-zinc-800 px-2.5 py-2 text-xs font-bold hover:bg-zinc-700"
                    >
                      ${v}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  Parimutuel: qualified traders split the pool pro-rata to their buy-in. Everyone trades the
                  same paper stack.
                </p>
              </div>
            )}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {signedIn ? (
            <button
              onClick={submit}
              disabled={busy || cost === 0}
              className="w-full rounded-xl bg-fuchsia-500 py-3 text-sm font-black text-zinc-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
            >
              {busy ? "Entering…" : cost > 0 ? `Enter · ${pdotEth(cost, 3)}` : "Pick a pool"}
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
        <div className="rounded-2xl bg-zinc-900/40 p-2 ring-1 ring-white/10">
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

        {/* The trade board — same widget, sounds, and treatment as the Cook Out. */}
        {entry?.trading ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1 text-[11px]">
              <span className="font-bold uppercase tracking-wide text-zinc-500">Trade the Swarm</span>
              <span className={pnl >= 0 ? "font-bold text-lime-300" : "font-bold text-red-400"}>
                PnL {pnl >= 0 ? "+" : ""}
                {pnl.toFixed(3)} pETH · {pnl > 0 ? "qualifying" : "not yet"}
              </span>
            </div>
            <TradePanel
              round={round}
              position={{ tokens: myTokens, costBasisEth: 0, realizedPnl: 0 }}
              ethUsd={ethUsd}
              price={price}
              variant="bar"
              balanceOverride={stack}
              onTraded={onTraded}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
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

        <GraduationProgress config={round.config} ticker={{ mcap, volume, holders, ethUsd }} />
        <OrderBook trades={trades} symbol={round.token.symbol} ethUsd={ethUsd} me={me} />
      </div>

      <div className="space-y-4">
        <Pools round={round} />

        {/* Swarm feed */}
        <div className="rounded-2xl bg-zinc-900/40 p-3 ring-1 ring-white/10">
          <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-fuchsia-300">Swarm AI</div>
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
