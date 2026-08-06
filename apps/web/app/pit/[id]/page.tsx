"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  PIT_DURATION_MAP,
  trialTierFor,
  marketCap,
  spotPrice,
  type BattleTier,
  type Candle,
  type KillFeedEvent,
  type PitCall,
  type PitEntry,
  type Round,
  type RoundSummary,
  type Trade,
} from "@cookout/shared";
import { PitPayout } from "../../../components/PitPayout";
import { enterBattle, leavePitPools, stakePrediction, stakeWei } from "../../../lib/pitPool";
import { api } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { useSocial } from "../../../lib/social";
import { useRoundSocket } from "../../../lib/useRoundSocket";
import { Chart } from "../../../components/Chart";
import { OrderBook } from "../../../components/OrderBook";
import { TradePanel } from "../../../components/TradePanel";
import { GraduationProgress } from "../../../components/GraduationProgress";
import { Countdown } from "../../../components/Countdown";
import { BattleFX, type FxEvent, type FxKind } from "../../../components/BattleFX";
import { EventStrip, PhaseFlash } from "../../../components/arena/ArenaEvents";
import { UrgencyPulse } from "../../../components/arena/RoundOverlays";
import { EdgeCallouts } from "../../../components/arena/EdgeCallouts";
import { FloatingReactions } from "../../../components/ArcadeOverlays";
import {
  playAthSparkle,
  playFanfare,
  playHorn,
  playMilestone,
  playRug,
  playThud,
  playTradeTick,
  playWhale,
} from "../../../lib/sfx";
import { pdotEth, fmtVal } from "../../../lib/pit";
import { PitResultsView, PitOutcomeModal, RunItBack } from "../../../components/PitResults";

/** The live-round drama state threaded from the socket into the trade view —
 *  the same flashes, shakes, sounds, and overlays the Cook Out arena runs. */
interface PitDrama {
  killfeed: KillFeedEvent[];
  fx: FxEvent[];
  shake: boolean;
  flash: { text: string; tone: "go" | "end" | "bad" } | null;
  reactions: Array<{ id: number; emoji: string }>;
  cooking: boolean;
  bigTradeEth: number;
  clockOffset: number;
}

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
  const [ticker, setTicker] = useState<{
    price: number;
    mcap: number;
    volume: number;
    holders: number;
    cooking?: boolean;
    liquidity?: number;
  } | null>(null);
  const [entry, setEntry] = useState<PitEntry | null>(null);
  // The difficulty ladder and its prices live on the server, so an operator's
  // edit in Command Center reaches the lobby without a deploy.
  const [battleTiers, setBattleTiers] = useState<BattleTierView[]>([]);
  const [stack, setStack] = useState(0);
  const [usd, setUsd] = useState(true);
  // The end-of-match win/lose modal, shown once when a match the player was in ends.
  const [showOutcome, setShowOutcome] = useState(false);

  // ---- live drama: flashes / shake / sounds / overlays (Cook Out parity) ----
  const [killfeed, setKillfeed] = useState<KillFeedEvent[]>([]);
  const [fx, setFx] = useState<FxEvent[]>([]);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState<{ text: string; tone: "go" | "end" | "bad" } | null>(null);
  const [reactions, setReactions] = useState<Array<{ id: number; emoji: string }>>([]);
  const liveRef = useRef(false);
  const myAddrRef = useRef<string | undefined>(undefined);
  const athRef = useRef(0);
  const bigEthRef = useRef(0.05);
  const clockOffset = useRef(0);

  const fireFx = useCallback((kind: FxKind) => {
    const fxId = Date.now() + Math.random();
    setFx((list) => [...list.slice(-8), { id: fxId, kind }]);
    setTimeout(() => setFx((list) => list.filter((f) => f.id !== fxId)), 1100);
  }, []);
  const quake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 650);
  }, []);
  const announce = useCallback((text: string, tone: "go" | "end" | "bad") => {
    setFlash({ text, tone });
    setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 1900);
  }, []);

  const round = data?.round;
  const pit = round?.pit;

  // Seed the killfeed from the initial load; sync the drama refs each render.
  useEffect(() => {
    if (data?.killfeed) setKillfeed(data.killfeed);
  }, [data?.killfeed]);
  liveRef.current = round?.state === "live";
  myAddrRef.current = profile?.address;
  bigEthRef.current = Math.max(0.05, (ticker?.liquidity ?? round?.config.initialEthLiquidity ?? 1) * 0.05);

  // A hard flash + horn when the match goes live — the bell.
  const wasLive = useRef(false);
  useEffect(() => {
    if (round?.state === "live" && !wasLive.current) {
      wasLive.current = true;
      announce("LIVE — beat the Goons", "go");
      playFanfare();
    }
  }, [round?.state, announce]);

  const loadRound = useCallback(() => {
    api<RoundData>(`/api/rounds/${id}`)
      .then((d) => {
        setData(d);
        setTrades(d.trades);
        setCandles(d.candles);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    api<{ config?: { battleTiers?: BattleTierView[] } }>("/api/pit")
      .then((d) => setBattleTiers(d.config?.battleTiers ?? []))
      .catch(() => {});
  }, []);

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
      const tk = ev as unknown as {
        price: number; mcap: number; volume: number; holders: number;
        cooking?: boolean; liquidity?: number; athMcap?: number; serverNow?: number;
      };
      setTicker({
        price: tk.price, mcap: tk.mcap, volume: tk.volume, holders: tk.holders,
        cooking: tk.cooking, liquidity: tk.liquidity,
      });
      if (typeof tk.serverNow === "number") clockOffset.current = tk.serverNow - Date.now();
      // New all-time-high market cap: sparkle + a sky flash.
      if (typeof tk.athMcap === "number") {
        if (athRef.current > 0 && tk.athMcap > athRef.current * 1.001 && liveRef.current) {
          playAthSparkle();
          fireFx("ath");
        }
        athRef.current = Math.max(athRef.current, tk.athMcap);
      }
    } else if (ev.type === "trade") {
      const t = ev.trade as Trade;
      setTrades((prev) => [...prev, { ...t, seenAt: Date.now() } as Trade].slice(-200));
      if (liveRef.current) {
        // Everyone else's trades tick past; the big ones flash the sky.
        if (t.userAddress !== myAddrRef.current) playTradeTick(t.side, t.ethAmount);
        if (t.ethAmount >= bigEthRef.current) fireFx(t.side === "buy" ? "buy" : "sell");
      }
    } else if (ev.type === "candle") {
      setCandles((c) => [...c, ev.candle as Candle].slice(-1200));
    } else if (ev.type === "killfeed") {
      const event = ev.event as KillFeedEvent;
      setKillfeed((prev) => [...prev.slice(-99), event]);
      if (liveRef.current) {
        switch (event.kind) {
          case "whale_entered": playWhale(); fireFx("whale"); break;
          case "rug_detected": playRug(); fireFx("rug"); quake(); announce("RUG PULL", "bad"); break;
          case "mcap_milestone": playMilestone(); fireFx("milestone"); break;
          case "new_leader": playHorn(); break;
          case "big_sell":
          case "dev_sell": playThud(); break;
          case "graduated": playFanfare(); fireFx("graduated"); announce("GRADUATED", "go"); break;
        }
      }
    } else if (ev.type === "reaction") {
      setReactions((prev) => [...prev.slice(-15), { id: Date.now() + Math.random(), emoji: ev.emoji as string }]);
    } else if (ev.type === "round_state") {
      setData((d) => (d ? { ...d, round: ev.round as Round } : d));
    } else if (ev.type === "round_end") {
      const summary = ev.summary as RoundSummary;
      setData((d) => (d ? { ...d, round: { ...d.round, state: "results" }, summary } : d));
      // Only surface the hero modal to players who actually entered this match.
      if (me && summary.pit?.players.some((p) => p.address === me)) setShowOutcome(true);
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
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-300">
          {d.icon} {d.name}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-lime-300/70">Powered by The Flame Goon Squad AI</span>
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

      {round.pitChain && <PitPayout pit={round.pitChain} />}

      {round.state === "lobby" && (
        <LobbyView
          round={round}
          entry={entry}
          stack={stack}
          ethUsd={data.ethUsd}
          fmt={fmt}
          me={me}
          signedIn={!!profile}
          onSignIn={signIn}
          battleTiers={battleTiers}
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
          drama={{
            killfeed,
            fx,
            shake,
            flash,
            reactions,
            cooking: ticker?.cooking ?? false,
            bigTradeEth: bigEthRef.current,
            clockOffset: clockOffset.current,
          }}
        />
      )}

      {round.state === "cancelled" && (
        <div className="mx-auto w-full max-w-xl rounded-2xl bg-zinc-900/50 p-8 text-center ring-1 ring-white/10">
          <div className="text-3xl">🚫</div>
          <div className="mt-2 text-lg font-black text-zinc-100">Match cancelled</div>
          <p className="mt-1 text-sm text-zinc-400">
            Not enough players pulled up before the queue timed out. Every deposit has been refunded to your Cook Out
            balance.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link
              href="/pit"
              className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-black text-zinc-200 hover:bg-zinc-700"
            >
              Back to The Pit
            </Link>
            {/* A cancelled match releases the coin, so the creator can put it
                straight back into a fresh lobby from here. */}
            {me && round.creatorAddress.toLowerCase() === me && <RunItBack round={round} />}
          </div>
        </div>
      )}

      {round.state === "results" && (
        <PitResultsView round={round} summary={data.summary} me={me} fmt={fmt} />
      )}

      {showOutcome &&
        (() => {
          const mine = me ? data?.summary?.pit?.players.find((p) => p.address === me) : undefined;
          return mine ? (
            <PitOutcomeModal round={round} mine={mine} fmt={fmt} onClose={() => setShowOutcome(false)} />
          ) : null;
        })()}
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

/** USD quick-stake chips shared by every Pit bet input. */
const BET_CHIPS_USD = [5, 10, 25, 50, 100];

const BET_ACCENT: Record<string, { text: string; ring: string; chip: string }> = {
  sky: { text: "text-sky-300", ring: "focus-within:ring-sky-400/60", chip: "bg-sky-500/20 text-sky-200 ring-sky-400/40" },
  amber: { text: "text-amber-300", ring: "focus-within:ring-amber-400/60", chip: "bg-amber-500/20 text-amber-200 ring-amber-400/40" },
  lime: { text: "text-lime-300", ring: "focus-within:ring-lime-400/60", chip: "bg-lime-500/20 text-lime-200 ring-lime-400/40" },
  orange: { text: "text-orange-300", ring: "focus-within:ring-orange-400/60", chip: "bg-orange-500/20 text-orange-200 ring-orange-400/40" },
};

/**
 * The shared Pit bet input — a big USD figure with quick-stake chips and the
 * pETH equivalent. Used by every mode (prediction, house, trading, trial) so the
 * betting screens read the same everywhere.
 */
function BetInput({
  value,
  onChange,
  peg,
  accent,
  minUsd,
  extra,
}: {
  value: string;
  onChange: (v: string) => void;
  peg: number;
  accent: "sky" | "amber" | "lime" | "orange";
  minUsd: number;
  /** Optional trailing controls (e.g. Flame Trial tier chips). */
  extra?: ReactNode;
}) {
  const a = BET_ACCENT[accent]!;
  const eth = (Number(value) || 0) / (peg > 0 ? peg : 1);
  return (
    <div className="mt-2 space-y-2">
      <div className={`flex items-center gap-2 rounded-xl bg-zinc-950/70 px-4 py-3 ring-1 ring-white/10 ${a.ring}`}>
        <span className={`text-2xl font-black ${a.text}`}>$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder={String(minUsd)}
          className="w-full bg-transparent font-mono text-3xl font-black text-zinc-50 outline-none placeholder:text-zinc-700"
        />
        <span className="shrink-0 text-right font-mono text-[11px] leading-tight text-zinc-500">
          ≈ {eth.toFixed(4)}
          <br />
          pETH
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {BET_CHIPS_USD.map((c) => (
          <button
            key={c}
            onClick={() => onChange(String(c))}
            className={`rounded-lg px-3 py-1.5 text-sm font-black ring-1 transition ${
              (Number(value) || 0) === c ? a.chip : "bg-zinc-800/80 text-zinc-300 ring-transparent hover:bg-zinc-700"
            }`}
          >
            ${c}
          </button>
        ))}
        {extra}
      </div>
      <div className="text-[11px] text-zinc-600">Min ${minUsd}. Paid from your Cook Out balance.</div>
    </div>
  );
}

function LobbyView({
  round,
  entry,
  stack,
  ethUsd,
  fmt,
  me,
  signedIn,
  onSignIn,
  onEntered,
  battleTiers,
}: {
  round: Round;
  entry: PitEntry | null;
  stack: number;
  ethUsd: number;
  fmt: (eth: number) => string;
  me?: string;
  signedIn: boolean;
  onSignIn: () => void;
  onEntered: () => void;
  /** Difficulty ladder from the server; it owns the prices. */
  battleTiers?: BattleTierView[];
}) {
  const pit = round.pit!;
  const predMode = pit.predictionMode;
  const tradeMode = pit.tradingMode;
  // Flame Trial is single-player: only the match creator plays it. Everyone else
  // in a trial round can still bet the prediction pool (if it's enabled).
  const isCreator = !!me && me === round.creatorAddress.toLowerCase();
  const trialModeOn = pit.trialMode && isCreator;
  const peg = ethUsd > 0 ? ethUsd : 1;
  // Every bet is placed in USD now, with a $5 minimum, converted to pETH on send.
  const BET_MIN_USD = 5;
  const betMaxUsd = pit.maxBet * peg;
  const ethToUsd = (eth: number) => (eth * peg).toFixed(0);

  const [editing, setEditing] = useState(false);
  const [call, setCall] = useState<PitCall | null>(null);
  const [mainBet, setMainBet] = useState<string>("5"); // USD
  const [house, setHouse] = useState(false);
  const [houseBet, setHouseBet] = useState<string>("5"); // USD
  const [trading, setTrading] = useState(false);
  // Battle the Goon Squad is a fixed price per difficulty rather than an
  // amount the player picks: with a free buy-in, entering for a fraction of
  // what everyone else risked still won the whole pot.
  const [battleTier, setBattleTier] = useState<BattleTier>("easy");
  const [trial, setTrial] = useState(false);
  const [trialUsd, setTrialUsd] = useState<string>(String(pit.trialMinUsd ?? 5));
  const [busy, setBusy] = useState(false);
  // Which on-chain stake is in flight, so the button says what is happening
  // instead of just spinning through two or three wallet transactions.
  const [staking, setStaking] = useState("");
  const [error, setError] = useState("");

  const armed = !!round.queueOpensAt;
  const clampUsd = (usd: number, label: string): string | null => {
    if (!(usd > 0)) return `${label} is required`;
    if (usd < BET_MIN_USD - 1e-6) return `${label} is below the $${BET_MIN_USD} minimum`;
    if (usd > betMaxUsd + 1e-6) return `${label} is above the $${Math.round(betMaxUsd)} maximum`;
    return null;
  };
  const usdToEth = (usd: string) => (Number(usd) || 0) / peg;
  const mainStake = call ? usdToEth(mainBet) : 0; // pETH
  const houseStake = house ? usdToEth(houseBet) : 0;
  const tierDefs: BattleTierView[] = battleTiers?.length
    ? battleTiers
    : [
        // Only used if the config request has not landed yet — the server is
        // the source of truth and these are its shipped defaults.
        { key: "easy", label: "Easy", entryUsd: 5, entryEth: 5 / peg, feeBps: 500 },
        { key: "medium", label: "Medium", entryUsd: 25, entryEth: 25 / peg, feeBps: 500 },
        { key: "hard", label: "Hard", entryUsd: 100, entryEth: 100 / peg, feeBps: 500 },
      ];
  const chosenTier = tierDefs.find((t) => t.key === battleTier) ?? tierDefs[0]!;
  const tradeStake = trading ? chosenTier.entryUsd / peg : 0;
  const trialUsdNum = trial ? Number(trialUsd) || 0 : 0;
  const trialStakeEth = trialUsdNum / peg;
  const trialTier = trialTierFor(Number(trialUsd) || 0, pit.trialTiers ?? []);
  // The tier the stake buys sets the PnL bar — a bigger stake means a higher bar.
  const targetPct = Math.round((trialTier.requiredPnlBps ?? pit.trialRequiredPnlBps) / 100);
  const cost = mainStake + houseStake + tradeStake + trialStakeEth;

  const startEdit = () => {
    if (!entry) return;
    setCall(entry.prediction ?? null);
    setMainBet(entry.predictionStake ? ethToUsd(entry.predictionStake) : "5");
    setHouse(!!entry.houseSpecial);
    setHouseBet(entry.houseSpecialStake ? ethToUsd(entry.houseSpecialStake) : "5");
    setTrading(!!entry.trading);
    if (entry.battleTier) setBattleTier(entry.battleTier);
    setTrial(!!entry.trial);
    setTrialUsd(entry.trialStake ? ((entry.trialStake * peg).toFixed(0)) : String(pit.trialMinUsd ?? 5));
    setEditing(true);
  };

  const submit = async () => {
    setError("");
    if (!call && !house && !trading && !trial) {
      setError("Place at least one bet.");
      return;
    }
    for (const [on, usd, label] of [
      [call, Number(mainBet) || 0, "Prediction bet"],
      [house, Number(houseBet) || 0, "House Special bet"],
      [trading, chosenTier.entryUsd, "Goon Squad buy-in"],
    ] as [unknown, number, string][]) {
      if (on) {
        const e = clampUsd(usd, label);
        if (e) {
          setError(e);
          return;
        }
      }
    }
    if (trial && (trialUsdNum < (pit.trialMinUsd ?? 5) || trialUsdNum > (pit.trialMaxUsd ?? 1e9))) {
      setError(`Flame Trial stake must be $${pit.trialMinUsd}–$${pit.trialMaxUsd}.`);
      return;
    }
    setBusy(true);
    try {
      // On a chain match the money goes from the player's wallet to the pool
      // contracts first, and only then does the server record the entry —
      // which it does by reading the pools, not by believing this call. Order
      // matters: stake, then register, so a failed stake never books a bet
      // that was never paid for.
      const pc = round.pitChain;
      if (pc) {
        if (call) {
          setStaking("prediction");
          await stakePrediction(pc, call, stakeWei(Number(mainBet) || 0, peg));
        }
        if (house) {
          setStaking("house special");
          await stakePrediction(pc, call ?? "graduate", stakeWei(Number(houseBet) || 0, peg));
        }
        if (trading) {
          setStaking("battle entry");
          await enterBattle(pc);
        }
        setStaking("");
      }
      await api(`/api/pit/${round.id}/enter`, {
        body: {
          prediction: call ?? undefined,
          predictionStake: call ? mainStake : undefined,
          houseSpecial: house || undefined,
          houseSpecialStake: house ? houseStake : undefined,
          trading: trading || undefined,
          // The server prices this from the tier; sending an amount would be
          // ignored, and sending one that disagreed would be misleading.
          battleTier: trading ? battleTier : undefined,
          trial: trial || undefined,
          trialStake: trial ? trialStakeEth : undefined,
        },
      });
      setEditing(false);
      onEntered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStaking("");
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError("");
    try {
      // Take the money out of the pools first. Clearing our own record while
      // the contract still holds the stake is what made re-entry fail.
      if (round.pitChain && entry) {
        setStaking("withdrawal");
        await leavePitPools(round.pitChain, {
          prediction: !!entry.prediction || !!entry.houseSpecial,
          battle: !!entry.trading,
        });
        setStaking("");
      }
      await api(`/api/pit/${round.id}/withdraw`, { body: {} });
      onEntered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A Flame Trial round is solo: the creator's stake starts a quick countdown on
  // its own, so the prediction side-pool never gates the start.
  const isTrialRound = pit.trialMode;
  const predLeft = predMode ? Math.max(0, 2 - pit.prediction.participants) : 0;
  const tradeLeft = tradeMode ? Math.max(0, 2 - pit.trading.participants) : 0;
  const trialLeft = isTrialRound ? Math.max(0, 1 - pit.trialParticipants) : 0;
  const needs: string[] = [];
  if (isTrialRound) {
    if (trialLeft > 0) needs.push(isCreator ? "you to stake your Flame Trial" : "the creator to start their Flame Trial");
  } else {
    if (predLeft > 0) needs.push(`${predLeft} prediction`);
    if (tradeLeft > 0) needs.push(`${tradeLeft} trader${tradeLeft === 1 ? "" : "s"}`);
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-3">
      {/* Status */}
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ${
          armed ? "bg-lime-500/10 ring-lime-500/30" : "bg-amber-500/10 ring-amber-500/25"
        }`}
      >
        {armed && round.queueOpensAt ? (
          <>
            <span className="text-sm font-black text-lime-200">🔒 Locked in. Going live.</span>
            <span className="font-mono text-lg font-black text-lime-200">
              <Countdown to={round.queueOpensAt} />
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-black text-amber-100">
              {isTrialRound ? <>🔥 Single-player Flame Trial</> : <>In the queue</>}
              <span className="block text-[11px] font-bold text-amber-200/80">
                Waiting on {needs.join(" and ")}.{" "}
                {round.pit!.queueMaxSeconds ? (
                  <>
                    Cancels in <Countdown to={round.scheduledAt + round.pit!.queueMaxSeconds * 1000} />
                  </>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 rounded-lg bg-black/30 px-2.5 py-1 font-mono text-xs font-black text-amber-200">
              {isTrialRound && <>{pit.trialParticipants}/1</>}
              {!isTrialRound && predMode && <>pred {pit.prediction.participants}/2</>}
              {!isTrialRound && predMode && tradeMode && " · "}
              {!isTrialRound && tradeMode && <>trade {pit.trading.participants}/2</>}
            </span>
          </>
        )}
      </div>

      <Pools round={round} fmt={fmt} />

      {entry && !editing ? (
        <div className="rounded-2xl bg-lime-500/10 p-4 ring-1 ring-lime-500/30">
          <div className="text-base font-black text-lime-300">✓ You&apos;re in</div>
          <div className="mt-2 space-y-1.5 text-sm">
            {entry.prediction && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">🔮 Prediction · <b className="capitalize text-zinc-100">{entry.prediction}</b></span>
                <b className="font-mono text-zinc-200">{fmt(entry.predictionStake ?? 0)}</b>
              </div>
            )}
            {entry.houseSpecial && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">🏠 {pit.houseSpecial?.name}</span>
                <b className="font-mono text-zinc-200">{fmt(entry.houseSpecialStake ?? 0)}</b>
              </div>
            )}
            {entry.trading && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">
                  ⚔️ Goon Squad
                  {entry.battleTier && (
                    <b className="ml-1 uppercase text-lime-300">{entry.battleTier}</b>
                  )}{" "}
                  · stack <b className="font-mono text-zinc-100">{fmt(stack)}</b>
                </span>
                <b className="font-mono text-zinc-200">{fmt(entry.tradingStake ?? 0)}</b>
              </div>
            )}
            {entry.trial && (
              <div className="flex items-center justify-between text-orange-200">
                <span>🔥 Flame Trial · target <b>+{targetPct}%</b></span>
                <b className="font-mono">{fmt(entry.trialStake ?? 0)}</b>
              </div>
            )}
          </div>
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={startEdit}
              disabled={busy}
              className="flex-1 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-black text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={withdraw}
              disabled={busy}
              className="flex-1 rounded-xl bg-red-500/15 px-4 py-2.5 text-sm font-black text-red-300 hover:bg-red-500/25 disabled:opacity-40"
            >
              {busy ? "…" : "Withdraw"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {armed ? "The Goon Squad is warming up." : "Edit or withdraw any time until it goes live."}
          </p>
        </div>
      ) : isTrialRound && !predMode && !isCreator ? (
        <div className="rounded-2xl bg-zinc-900/50 p-6 text-center ring-1 ring-white/10">
          <div className="text-base font-black text-orange-300">🔥 Single-player Flame Trial</div>
          <p className="mt-1.5 text-sm text-zinc-400">
            This is the creator&apos;s solo run against the Goon Squad. There&apos;s nothing to enter here — stick around
            to watch them chase +{targetPct}%.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Prediction */}
          {predMode && (
            <BetCard accent="sky" icon="🔮" title="Prediction" active={!!call}
              subtitle="Call how it ends. Correct callers split the pool.">
              <div className="grid grid-cols-3 gap-2">
                {CALLS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCall(call === c.key ? null : c.key)}
                    className={`rounded-xl p-3 text-center ring-1 transition ${
                      call === c.key
                        ? "bg-sky-500/25 ring-sky-400 ring-2"
                        : "bg-zinc-800/60 ring-white/10 hover:ring-white/30"
                    }`}
                  >
                    <div className="text-3xl">{c.icon}</div>
                    <div className="mt-1 text-sm font-black text-zinc-50">{c.label}</div>
                    <div className="text-[10px] leading-tight text-zinc-400">{c.blurb}</div>
                  </button>
                ))}
              </div>
              {call && <BetInput value={mainBet} onChange={setMainBet} peg={peg} accent="sky" minUsd={BET_MIN_USD} />}
            </BetCard>
          )}

          {/* House Special */}
          {predMode && pit.houseSpecial && (
            <BetCard accent="amber" icon="🏠" title={`House Special · ${pit.houseSpecial.name}`} active={house}
              subtitle={`${pit.houseSpecial.blurb}. Optional side bet, paid if it hits.`}
              onToggle={() => setHouse((h) => !h)} toggled={house}>
              {house && <BetInput value={houseBet} onChange={setHouseBet} peg={peg} accent="amber" minUsd={BET_MIN_USD} />}
            </BetCard>
          )}

          {/* Trading */}
          {tradeMode && (
            <BetCard accent="lime" icon="⚔️" title="Battle the Goon Squad" active={trading}
              subtitle={`Trade a ${fmt(pit.startingStack)} paper stack vs the AI. Highest PnL takes the pot — everyone in a tier pays the same to enter.`}
              onToggle={() => setTrading((t) => !t)} toggled={trading}>
              {trading && (
                <BattleTierPicker
                  tiers={tierDefs}
                  chosen={battleTier}
                  onChoose={setBattleTier}
                  peg={peg}
                />
              )}
            </BetCard>
          )}

          {/* Flame Trial */}
          {trialModeOn && (
            <BetCard accent="orange" icon="🔥" title="Flame Trial · single-player" active={trial}
              subtitle={`Your solo run. Stake the coin and trade a ${fmt(pit.startingStack)} stack. Starts on a ${pit.trialLobbySeconds ?? 15}s countdown once you stake.`}
              onToggle={() => setTrial((t) => !t)} toggled={trial}>
              {trial && (
                <>
                  <BetInput value={trialUsd} onChange={setTrialUsd} peg={peg} accent="orange" minUsd={pit.trialMinUsd ?? 5} />
                  <div className="mt-3 rounded-xl bg-black/30 p-3 ring-1 ring-orange-500/20">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-black text-orange-300">{trialTier.name} tier</span>
                      <span className="font-mono font-black text-orange-200">finish +{targetPct}% to pass</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs leading-relaxed text-zinc-300">
                      <div>
                        <b className="text-lime-300">Pass:</b> your ${Number(trialUsd) || 0} stake comes back, plus {trialTier.xp} XP and {trialTier.name}-tier titles and badges.
                      </div>
                      <div>
                        <b className="text-red-300">Miss:</b> the stake is gone. Prestige only, never a cash payout.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </BetCard>
          )}

          {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-bold text-red-300">{error}</div>}

          <div className="flex gap-2 pt-1">
            {editing && (
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="rounded-xl bg-zinc-800 px-5 py-3.5 text-sm font-black text-zinc-200 hover:bg-zinc-700"
              >
                Cancel
              </button>
            )}
            {signedIn ? (
              <button
                onClick={submit}
                disabled={busy || cost === 0}
                className="flex-1 rounded-xl bg-lime-400 py-3.5 text-base font-black text-zinc-950 shadow-lg shadow-lime-500/20 transition hover:bg-lime-300 disabled:opacity-40 disabled:shadow-none"
              >
                {staking
                  ? `Confirm the ${staking}…`
                  : busy
                    ? "Placing…"
                    : cost > 0
                      ? `${editing ? "Update bet" : "Place bet"} · ${fmt(cost)}`
                      : "Pick a bet above"}
              </button>
            ) : (
              <button
                onClick={onSignIn}
                className="flex-1 rounded-xl bg-lime-400 py-3.5 text-base font-black text-zinc-950 hover:bg-lime-300"
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

/**
 * A single betting-mode panel: a bold, tappable header (icon, title, subtitle,
 * and an on/off state) over the mode's controls. Gives all three Pit modes the
 * same clear, game-like frame.
 */
/** One difficulty tier as the server describes it. */
interface BattleTierView {
  key: BattleTier;
  label: string;
  entryUsd: number;
  entryEth: number;
  feeBps: number;
}

/**
 * Pick a difficulty, which is the same thing as picking a price.
 *
 * Deliberately not an amount box. Everyone in a tier pays the same, so winning
 * the pot is the same bet for all of them — the thing a free buy-in quietly
 * broke, since a small entrant took the whole pot on a win.
 */
function BattleTierPicker({
  tiers,
  chosen,
  onChoose,
  peg,
}: {
  tiers: BattleTierView[];
  chosen: BattleTier;
  onChoose: (t: BattleTier) => void;
  peg: number;
}) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {tiers.map((t) => {
          const active = t.key === chosen;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChoose(t.key)}
              className={`rounded-xl px-2 py-3 text-center transition ring-1 ${
                active
                  ? "bg-lime-400 text-zinc-950 ring-lime-300"
                  : "bg-zinc-900/70 text-zinc-300 ring-white/10 hover:bg-zinc-800"
              }`}
            >
              <div className="text-xs font-black uppercase tracking-wide">{t.label}</div>
              <div className="mt-0.5 font-mono text-lg font-black">${t.entryUsd}</div>
              <div className={`text-[10px] ${active ? "text-zinc-800" : "text-zinc-500"}`}>
                {(t.entryUsd / peg).toFixed(4)} pETH
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-zinc-500">
        Fixed entry — everyone in this tier pays the same, so the pot is simply the number of
        players times the buy-in. Highest PnL takes it.
      </p>
    </div>
  );
}

function BetCard({
  accent,
  icon,
  title,
  subtitle,
  active,
  toggled,
  onToggle,
  children,
}: {
  accent: "sky" | "amber" | "lime" | "orange";
  icon: string;
  title: string;
  subtitle: string;
  active: boolean;
  /** For opt-in modes: current on/off + handler. Omit for always-open prediction. */
  toggled?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const a = BET_ACCENT[accent]!;
  const on = onToggle ? !!toggled : active;
  const ringOn =
    accent === "sky" ? "ring-sky-400/50" : accent === "amber" ? "ring-amber-400/50" : accent === "lime" ? "ring-lime-400/50" : "ring-orange-400/50";
  const glowOn =
    accent === "sky" ? "bg-sky-500/[0.08]" : accent === "amber" ? "bg-amber-500/[0.08]" : accent === "lime" ? "bg-lime-500/[0.08]" : "bg-orange-500/[0.08]";
  const Header = onToggle ? "button" : "div";
  return (
    <div className={`overflow-hidden rounded-2xl ring-1 transition ${on ? `${ringOn} ${glowOn}` : "bg-zinc-900/40 ring-white/10"}`}>
      <Header
        onClick={onToggle}
        className={`flex w-full items-center gap-3 p-3.5 text-left ${onToggle ? "hover:bg-white/5" : ""}`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/30 text-xl ${a.text}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-black text-zinc-50">{title}</span>
          <span className="block text-xs leading-snug text-zinc-400">{subtitle}</span>
        </span>
        {onToggle && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black ${on ? `${a.chip} ring-1` : "bg-zinc-700 text-zinc-300"}`}>
            {on ? "✓" : "+"}
          </span>
        )}
      </Header>
      {children && <div className="border-t border-white/5 p-3.5">{children}</div>}
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
  drama,
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
  drama: PitDrama;
}) {
  const isTrader = !!(entry?.trading || entry?.trial);
  const startStack = round.pit!.startingStack;
  const pnl = isTrader ? stack + myTokens * price - startStack : 0;
  const pnlPct = startStack > 0 ? (pnl / startStack) * 100 : 0;
  // The trial bar follows the player's staked tier, not the round default.
  const trialTier = entry?.trial
    ? trialTierFor((entry.trialStake ?? 0) * (ethUsd > 0 ? ethUsd : 1), round.pit!.trialTiers ?? [])
    : null;
  const targetPct = Math.round((trialTier?.requiredPnlBps ?? round.pit!.trialRequiredPnlBps) / 100);
  const trialPassing = pnlPct >= targetPct;
  // With a single prize pool the page centers better if the pool sits above the
  // chart; two pools keep the right-hand sidebar.
  const poolCount = (round.pit!.predictionMode ? 1 : 0) + (round.pit!.tradingMode ? 1 : 0);
  const twoCol = poolCount >= 2;
  return (
    <div className={twoCol ? "grid gap-4 lg:grid-cols-[1fr_320px]" : "mx-auto max-w-3xl"}>
      {!twoCol && poolCount === 1 && (
        <div className="mb-4">
          <Pools round={round} fmt={fmt} />
        </div>
      )}
      <div className="space-y-4">
        {/* The event feed — whale entries, milestones, big sells, leader flips. */}
        <EventStrip killfeed={drama.killfeed} since={round.liveAt} live={round.state === "live"} />
        {/* Chart with the full Cook Out drama layer: shockwave flashes, screen
            shake on a rug, an urgency pulse in the final minute, phase banners,
            edge callouts, and floating crowd reactions. */}
        <div className={`relative rounded-2xl bg-zinc-900/40 p-2 ring-1 ring-white/10 ${drama.shake ? "fx-shake" : ""}`}>
          <BattleFX events={drama.fx} />
          <EdgeCallouts killfeed={drama.killfeed} />
          <UrgencyPulse endsAt={round.endsAt} active={round.state === "live"} nowOffset={drama.clockOffset} />
          {drama.flash && <PhaseFlash text={drama.flash.text} tone={drama.flash.tone} />}
          <FloatingReactions reactions={drama.reactions} />
          <Chart
            candles={candles}
            trades={trades}
            livePrice={price}
            supply={round.config.totalSupply}
            bigTradeEth={drama.bigTradeEth}
            cooking={drama.cooking}
            ethUsd={ethUsd}
            liveAt={round.liveAt}
            liquidity={round.pool?.ethReserve}
            highlightAddress={me}
            phase={round.state}
            bubbleLabels={false}
            endReason={round.graduated ? undefined : round.endReason}
            graduated={round.graduated}
          />
        </div>

        {/* Flame Trial objective progress. */}
        {entry?.trial && (
          <div className={`rounded-xl p-3 ring-1 ${trialPassing ? "bg-lime-500/10 ring-lime-400/40" : "bg-orange-500/[0.06] ring-orange-500/25"}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-black uppercase tracking-wide text-orange-300">🔥 Flame Trial · target +{targetPct}%</span>
              <span className={`font-mono font-black ${pnlPct >= 0 ? "text-lime-300" : "text-red-400"}`}>
                {pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${trialPassing ? "bg-lime-400" : "bg-orange-400"}`}
                style={{ width: `${Math.max(2, Math.min(100, (pnlPct / Math.max(1, targetPct)) * 100))}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {trialPassing ? "Passing — lock it in before the bell." : `${(targetPct - pnlPct).toFixed(1)}% to go.`}
            </div>
          </div>
        )}

        {/* The trade board — same widget, sounds, and treatment as the Cook Out. */}
        {isTrader ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1 text-[11px]">
              <span className="font-bold uppercase tracking-wide text-zinc-500">
                {entry?.trial && !entry?.trading ? "Flame Trial · Trade the Goons" : "Battle the Flame Goon Squad AI"}
              </span>
              <span className="flex items-center gap-2">
                <span className={pnl >= 0 ? "font-bold text-lime-300" : "font-bold text-red-400"}>
                  PnL {pnl >= 0 ? "+" : ""}
                  {fmt(pnl)}
                </span>
                <span className="text-zinc-500">{entry?.trading ? "highest PnL wins" : `hit +${targetPct}%`}</span>
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

      {twoCol && (
        <div className="space-y-4">
          <Pools round={round} fmt={fmt} />
        </div>
      )}
    </div>
  );
}
