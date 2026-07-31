"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { pdotEth, fmtVal } from "../../../lib/pit";
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
  { key: "rug", label: "Rug", icon: "🔻", blurb: "The Goon Squad pulls it" },
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
  const [entry, setEntry] = useState<PitEntry | null>(null);
  const [stack, setStack] = useState(0);
  const [usd, setUsd] = useState(true);

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
    if (!me) return { tokens: 0, trades: 0 };
    let tokens = 0;
    let count = 0;
    for (const t of trades)
      if (t.userAddress.toLowerCase() === me) {
        tokens += t.side === "buy" ? t.tokenAmount : -t.tokenAmount;
        count++;
      }
    return { tokens: Math.max(0, tokens), trades: count };
  }, [trades, me]);

  if (!round) return <div className="py-24 text-center text-zinc-600">Loading The Pit…</div>;

  const d = PIT_DURATION_MAP[pit?.duration ?? "standard"];
  const price = ticker?.price ?? (round.pool ? spotPrice(round.pool) : 0);
  const mcap = ticker?.mcap ?? (round.pool ? marketCap(round.pool) : 0);
  const ethUsd = data?.ethUsd ?? 0;
  const fmt = (eth: number) => fmtVal(eth, usd, ethUsd);

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
        <span className="text-[11px] font-bold uppercase tracking-wide text-fuchsia-300/70">Powered by The Flame Goon Squad AI</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex overflow-hidden rounded-full bg-zinc-900/70 text-[10px] font-bold ring-1 ring-white/10">
            {(["peth", "usd"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setUsd(k === "usd")}
                className={`px-2.5 py-1 ${(usd ? "usd" : "peth") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {k === "usd" ? "USD" : "pETH"}
              </button>
            ))}
          </div>
          {round.state === "live" && round.endsAt && (
            <span className="font-mono text-lg font-black text-lime-300">
              <Countdown to={round.endsAt} />
            </span>
          )}
        </div>
      </div>

      {round.state === "lobby" && (
        <LobbyView
          round={round}
          entry={entry}
          stack={stack}
          ethUsd={data.ethUsd}
          fmt={fmt}
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
          fmt={fmt}
          me={me}
          entry={entry}
          stack={stack}
          myTokens={myPos.tokens}
          onTraded={loadMe}
        />
      )}

      {round.state === "results" && (
        <PitResultsView round={round} summary={data.summary} me={me} fmt={fmt} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Pools({ round, fmt }: { round: Round; fmt: (eth: number) => string }) {
  const pit = round.pit!;
  const feeRate = pit.pitFeeBps / 10_000;
  const netPred = pit.prediction.pot * (1 - feeRate);
  const hasHouse = !!pit.houseSpecial && pit.houseParticipants > 0;
  const mainBucket = hasHouse ? (netPred * pit.mainAllocationBps) / 10_000 : netPred;
  const houseBucket = hasHouse ? (netPred * pit.houseAllocationBps) / 10_000 : 0;
  const netTrade = pit.trading.pot * (1 - feeRate);
  return (
    <div className={`grid gap-3 ${pit.predictionMode && pit.tradingMode ? "sm:grid-cols-2" : ""}`}>
      {pit.predictionMode && (
        <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
          <div className="text-xs text-zinc-500">Prediction prize pool</div>
          <div className="font-mono text-xl font-black text-zinc-50">{fmt(netPred)}</div>
          <div className="mt-1.5 space-y-0.5 text-[11px]">
            <div className="flex justify-between text-zinc-500">
              <span>🔮 Main ({Math.round(pit.mainAllocationBps / 100)}%)</span>
              <span className="font-mono text-zinc-300">
                {fmt(mainBucket)} · {pit.mainParticipants} in
              </span>
            </div>
            {pit.houseSpecial && (
              <div className="flex justify-between text-zinc-500">
                <span>🏠 House ({Math.round(pit.houseAllocationBps / 100)}%)</span>
                <span className="font-mono text-zinc-300">
                  {fmt(houseBucket)} · {pit.houseParticipants} in
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {pit.tradingMode && (
        <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
          <div className="text-xs text-zinc-500">Trading pool</div>
          <div className="font-mono text-xl font-black text-zinc-50">{fmt(netTrade)}</div>
          <div className="text-[11px] text-zinc-600">
            {pit.trading.participants} in · highest PnL wins
          </div>
        </div>
      )}
    </div>
  );
}

function BetInput({
  value,
  onChange,
  chips,
  min,
  max,
  peg,
  accent,
}: {
  value: string;
  onChange: (v: string) => void;
  chips: number[];
  min: number;
  max: number;
  peg: number;
  accent: "fuchsia" | "amber" | "lime";
}) {
  const ring =
    accent === "amber"
      ? "focus:ring-amber-400/50"
      : accent === "lime"
        ? "focus:ring-lime-400/50"
        : "focus:ring-fuchsia-400/50";
  return (
    <div className="mt-2 rounded-xl bg-zinc-900/60 p-3 ring-1 ring-white/10">
      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500">
        <span>Stake (pETH)</span>
        <span className="font-mono text-zinc-400">≈ ${(Number(value || 0) * peg).toFixed(2)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className={`w-24 rounded-lg bg-zinc-950/60 px-3 py-2 text-center font-mono text-lg outline-none ring-1 ring-white/10 ${ring}`}
        />
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => onChange(String(c))}
            className="rounded-lg bg-zinc-800 px-2.5 py-2 text-xs font-bold hover:bg-zinc-700"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-zinc-600">
        min {min} · max {max} pETH
      </div>
    </div>
  );
}

function LobbyView({
  round,
  entry,
  stack,
  ethUsd,
  fmt,
  signedIn,
  onSignIn,
  onEntered,
}: {
  round: Round;
  entry: PitEntry | null;
  stack: number;
  ethUsd: number;
  fmt: (eth: number) => string;
  signedIn: boolean;
  onSignIn: () => void;
  onEntered: () => void;
}) {
  const pit = round.pit!;
  const predMode = pit.predictionMode;
  const tradeMode = pit.tradingMode;
  const peg = ethUsd > 0 ? ethUsd : 1;
  const chips = pit.quickChips ?? [0.05, 0.1, 0.25, 0.5, 1];
  const firstChip = String(chips[0] ?? pit.minBet);

  const [editing, setEditing] = useState(false);
  const [call, setCall] = useState<PitCall | null>(null);
  const [mainBet, setMainBet] = useState<string>(firstChip);
  const [house, setHouse] = useState(false);
  const [houseBet, setHouseBet] = useState<string>(firstChip);
  const [trading, setTrading] = useState(false);
  const [tradeBet, setTradeBet] = useState<string>(String(pit.tradingFee));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const armed = !!round.queueOpensAt;
  const clampErr = (v: number, label: string): string | null => {
    if (!(v > 0)) return `${label} required`;
    if (v < pit.minBet - 1e-9) return `${label} below ${pit.minBet} pETH min`;
    if (v > pit.maxBet + 1e-9) return `${label} above ${pit.maxBet} pETH max`;
    return null;
  };
  const mainStake = call ? Number(mainBet) || 0 : 0;
  const houseStake = house ? Number(houseBet) || 0 : 0;
  const tradeStake = trading ? Number(tradeBet) || 0 : 0;
  const cost = mainStake + houseStake + tradeStake;

  const startEdit = () => {
    if (!entry) return;
    setCall(entry.prediction ?? null);
    setMainBet(entry.predictionStake ? String(entry.predictionStake) : firstChip);
    setHouse(!!entry.houseSpecial);
    setHouseBet(entry.houseSpecialStake ? String(entry.houseSpecialStake) : firstChip);
    setTrading(!!entry.trading);
    setTradeBet(entry.tradingStake ? String(entry.tradingStake) : String(pit.tradingFee));
    setEditing(true);
  };

  const submit = async () => {
    setError("");
    if (!call && !house && !trading) {
      setError("Place at least one bet.");
      return;
    }
    for (const [on, v, label] of [
      [call, mainStake, "Main bet"],
      [house, houseStake, "House Special bet"],
      [trading, tradeStake, "Trading buy-in"],
    ] as [unknown, number, string][]) {
      if (on) {
        const e = clampErr(v, label);
        if (e) {
          setError(e);
          return;
        }
      }
    }
    setBusy(true);
    try {
      await api(`/api/pit/${round.id}/enter`, {
        body: {
          prediction: call ?? undefined,
          predictionStake: call ? mainStake : undefined,
          houseSpecial: house || undefined,
          houseSpecialStake: house ? houseStake : undefined,
          trading: trading || undefined,
          tradingStake: trading ? tradeStake : undefined,
        },
      });
      setEditing(false);
      onEntered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/pit/${round.id}/withdraw`, { body: {} });
      onEntered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const predLeft = predMode ? Math.max(0, 2 - pit.prediction.participants) : 0;
  const tradeLeft = tradeMode ? Math.max(0, 2 - pit.trading.participants) : 0;
  const needs: string[] = [];
  if (predLeft > 0) needs.push(`${predLeft} prediction`);
  if (tradeLeft > 0) needs.push(`${tradeLeft} trader${tradeLeft === 1 ? "" : "s"}`);

  return (
    <div className="space-y-4">
      {/* Status */}
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
            <span className="font-bold text-amber-200">Waiting on {needs.join(" and ")} to start.</span>
            <span className="font-mono text-[11px] font-bold text-amber-200">
              {predMode && <>pred {pit.prediction.participants}/2</>}
              {predMode && tradeMode && " · "}
              {tradeMode && <>trade {pit.trading.participants}/2</>}
            </span>
          </>
        )}
      </div>

      {pit.houseSpecial && predMode && (
        <div className="rounded-2xl bg-amber-500/[0.06] p-3 ring-1 ring-amber-500/25">
          <span className="text-[10px] font-black uppercase tracking-wide text-amber-300/80">
            🏠 Featured House Special
          </span>
          <div className="text-sm font-black text-amber-200">
            {pit.houseSpecial.name} <span className="font-normal text-zinc-400">— {pit.houseSpecial.blurb}</span>
          </div>
        </div>
      )}

      <Pools round={round} fmt={fmt} />

      {entry && !editing ? (
        <div className="rounded-2xl bg-lime-500/[0.06] p-4 ring-1 ring-lime-500/20">
          <div className="text-sm font-black text-lime-300">You&apos;re in.</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300">
            {entry.prediction && (
              <span>
                Main <b className="capitalize">{entry.prediction}</b>
                <b className="ml-1 font-mono text-zinc-400">{fmt(entry.predictionStake ?? 0)}</b>
              </span>
            )}
            {entry.houseSpecial && (
              <span>
                🏠 {pit.houseSpecial?.name}
                <b className="ml-1 font-mono text-zinc-400">{fmt(entry.houseSpecialStake ?? 0)}</b>
              </span>
            )}
            {entry.trading && (
              <span>
                Trading stack <b className="font-mono">{fmt(stack)}</b>
                <b className="ml-1 font-mono text-zinc-400">· bet {fmt(entry.tradingStake ?? 0)}</b>
              </span>
            )}
          </div>
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={startEdit}
              disabled={busy}
              className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-black text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={withdraw}
              disabled={busy}
              className="rounded-xl bg-red-500/15 px-4 py-2 text-xs font-black text-red-300 hover:bg-red-500/25 disabled:opacity-40"
            >
              {busy ? "…" : "Withdraw"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            {armed ? "The Goon Squad is warming up." : "Edit or withdraw any time until it goes live."}
          </p>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl bg-zinc-900/40 p-4 ring-1 ring-white/10">
          {/* Main prediction */}
          {predMode && (
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                Main prediction
              </div>
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
                <BetInput value={mainBet} onChange={setMainBet} chips={chips} min={pit.minBet} max={pit.maxBet} peg={peg} accent="fuchsia" />
              )}
            </div>
          )}

          {/* House Special */}
          {predMode && pit.houseSpecial && (
            <div>
              <button
                onClick={() => setHouse((h) => !h)}
                className={`flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition ${
                  house ? "bg-amber-500/15 ring-amber-400/50" : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${house ? "bg-amber-400 text-zinc-950" : "bg-zinc-700 text-zinc-300"}`}>
                  {house ? "✓" : "+"}
                </span>
                <span className="flex-1">
                  <span className="text-sm font-black text-zinc-100">🏠 House Special · {pit.houseSpecial.name}</span>
                  <span className="block text-[11px] text-zinc-500">
                    {pit.houseSpecial.blurb}. Optional side bet — win it if it hits.
                  </span>
                </span>
              </button>
              {house && (
                <BetInput value={houseBet} onChange={setHouseBet} chips={chips} min={pit.minBet} max={pit.maxBet} peg={peg} accent="amber" />
              )}
            </div>
          )}

          {/* Trading */}
          {tradeMode && (
            <div>
              <button
                onClick={() => setTrading((t) => !t)}
                className={`flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition ${
                  trading ? "bg-lime-500/15 ring-lime-400/50" : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${trading ? "bg-lime-400 text-zinc-950" : "bg-zinc-700 text-zinc-300"}`}>
                  {trading ? "✓" : "+"}
                </span>
                <span className="flex-1">
                  <span className="text-sm font-black text-zinc-100">Battle the Flame Goon Squad AI</span>
                  <span className="block text-[11px] text-zinc-500">
                    Trade a {fmt(pit.startingStack)} paper stack against the Goons. Highest PnL wins the pool.
                  </span>
                </span>
              </button>
              {trading && (
                <BetInput value={tradeBet} onChange={setTradeBet} chips={chips} min={pit.minBet} max={pit.maxBet} peg={peg} accent="lime" />
              )}
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex gap-2">
            {editing && (
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="rounded-xl bg-zinc-800 px-4 py-3 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
            )}
            {signedIn ? (
              <button
                onClick={submit}
                disabled={busy || cost === 0}
                className="flex-1 rounded-xl bg-fuchsia-500 py-3 text-sm font-black text-zinc-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
              >
                {busy ? "Placing…" : cost > 0 ? `${editing ? "Update" : "Place bets"} · ${fmt(cost)}` : "Place a bet"}
              </button>
            ) : (
              <button
                onClick={onSignIn}
                className="flex-1 rounded-xl bg-lime-400 py-3 text-sm font-black text-zinc-950 hover:bg-lime-300"
              >
                Sign in to enter The Pit
              </button>
            )}
          </div>
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
  fmt,
  me,
  entry,
  stack,
  myTokens,
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
  fmt: (eth: number) => string;
  me?: string;
  entry: PitEntry | null;
  stack: number;
  myTokens: number;
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
              <span className="font-bold uppercase tracking-wide text-zinc-500">
                Battle the Flame Goon Squad AI
              </span>
              <span className="flex items-center gap-2">
                <span className={pnl >= 0 ? "font-bold text-lime-300" : "font-bold text-red-400"}>
                  PnL {pnl >= 0 ? "+" : ""}
                  {fmt(pnl)}
                </span>
                <span className="text-zinc-500">highest PnL wins</span>
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
                You called <b className="capitalize text-zinc-100">{entry.prediction}</b>. Watch the Goon
                Squad and see if it lands.
              </>
            ) : (
              "You're spectating. Entry closed at the bell."
            )}
          </div>
        )}

        <GraduationProgress config={round.config} ticker={{ mcap, volume, holders, ethUsd }} />
        <OrderBook trades={trades} symbol={round.token.symbol} ethUsd={ethUsd} me={me} />
      </div>

      <div className="space-y-4">
        <Pools round={round} fmt={fmt} />
      </div>
    </div>
  );
}
