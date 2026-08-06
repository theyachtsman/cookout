"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  AuctionResult,
  Candle,
  KillFeedActor,
  KillFeedEvent,
  MyFill,
  Round,
  RoundSummary,
  Trade,
} from "@cookout/shared";
import { api } from "../../../lib/api";
import { chainSell, walletTokenBalanceWei } from "../../../lib/chainTx";
import { playAthSparkle, playFanfare, playHorn, playMilestone, playRug, playSell, playThud, playTradeTick, playWhale } from "../../../lib/sfx";
import { audio } from "../../../lib/audio";
import { useSession } from "../../../lib/session";
import { useSocial } from "../../../lib/social";
import { useRoundSocket } from "../../../lib/useRoundSocket";
import { FloatingReactions } from "../../../components/ArcadeOverlays";
import { Chart } from "../../../components/Chart";
import { TopHolders } from "../../../components/TopHolders";
import { Countdown } from "../../../components/Countdown";
import { GraduationProgress } from "../../../components/GraduationProgress";
import { BattleFX, type FxEvent, type FxKind } from "../../../components/BattleFX";
import { ArenaHeader } from "../../../components/arena/ArenaHeader";
import { EventStrip, PhaseFlash } from "../../../components/arena/ArenaEvents";
import { EdgeCallouts } from "../../../components/arena/EdgeCallouts";
import { ActorFace } from "../../../components/arena/ActorFace";
import { FirstMatchCelebration } from "../../../components/arena/FirstMatchCelebration";
import { RoundOverlays, UrgencyPulse } from "../../../components/arena/RoundOverlays";
import { LiveLeaders } from "../../../components/arena/LiveLeaders";
import { PnlShareCard } from "../../../components/PnlShareCard";
import { ArenaWalletPanel } from "../../../components/ArenaWalletPanel";
import { ChainActions } from "../../../components/ChainActions";
import { QueuePanel } from "../../../components/QueuePanel";
import { Results } from "../../../components/Results";
import { RoundResultsOverlay, type EndBreakdown } from "../../../components/RoundResults";
import { TradePanel } from "../../../components/TradePanel";
import { OrderBook } from "../../../components/OrderBook";
import { RugMeter, type RugInfo } from "../../../components/RugMeter";

interface Ticker {
  price: number;
  mcap: number;
  athMcap?: number;
  liquidity: number;
  volume: number;
  holders: number;
  ageSeconds: number;
  cooking?: boolean;
  ethUsd?: number;
}

interface Lobby {
  players: number;
  spectators: number;
  committedEth: number;
  avgEntry: number;
}

const isRugRound = (r: Round) =>
  r.endReason === "rug_detected" || r.endReason === "liquidity_removed";

export default function RoundPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // The Pit is a distinct match type with its own screen (pools, paper stacks,
  // Swarm AI). A Pit round rendered here would try to run the Cookout auction
  // path, so hand it straight to /pit/:id (ledger + results links land here).
  const pitRedirected = useRef(false);
  const { profile, refresh } = useSession();
  const { setActiveRoom } = useSocial();
  const [round, setRound] = useState<Round | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [killfeed, setKillfeed] = useState<KillFeedEvent[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  // The ETH/USD peg from the round payload, so dollar entry works during the
  // pull-up queue too (before the live ticker starts carrying ethUsd).
  const [pegUsd, setPegUsd] = useState<number>();
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [auction, setAuction] = useState<AuctionResult | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [preds, setPreds] = useState<{ moon: number; rug: number }>({ moon: 0, rug: 0 });
  const [reactions, setReactions] = useState<Array<{ id: number; emoji: string }>>([]);
  const [leaders, setLeaders] = useState<Array<{ address: string; displayName?: string; badge?: string; value: number }>>([]);
  const [position, setPosition] = useState<{ tokens: number; costBasisEth: number; realizedPnl: number } | null>(null);
  // Rug meter — creator-only, delivered by /me while the round is live.
  const [rug, setRug] = useState<RugInfo | null>(null);
  // Your Fair Open result (committed vs cleared vs refunded), from /me. Shown as
  // a dismissible receipt over the trade deck so a partial fill is obvious the
  // moment the round opens.
  const [fill, setFill] = useState<MyFill | null>(null);
  const [fillDismissed, setFillDismissed] = useState(false);

  // ---- battle FX: flashes/shockwaves + soundscape driven by WS events ----
  const [fx, setFx] = useState<FxEvent[]>([]);
  const [shake, setShake] = useState(false);
  const fireFx = useCallback((kind: FxKind) => {
    const id = Date.now() + Math.random();
    setFx((list) => [...list.slice(-8), { id, kind }]);
    setTimeout(() => setFx((list) => list.filter((f) => f.id !== id)), 1100);
  }, []);
  /** COOK!: flash the chart, shake the arena, and let the tape start. */
  const onCook = useCallback(() => {
    setLaunching(true);
    setTimeout(() => setLaunching(false), 500);
  }, []);
  const quake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 650);
  }, []);
  // End-of-round overlay: pre-redemption snapshot vs post gives the exact
  // amount the uniform redemption returned.
  const [endResults, setEndResults] = useState<{ summary: RoundSummary; breakdown: EndBreakdown | null } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  // Short announcement over the chart when the round changes gear.
  const [flash, setFlash] = useState<{ text: string; tone: "go" | "end" | "bad" } | null>(null);
  // Over Time: a big buzzer-beater banner when the coin earns a bonus minute.
  const [overtime, setOvertime] = useState<{ minute: number } | null>(null);
  // The dev-sell banner: who sold, with their picture, front and centre.
  const [devSell, setDevSell] = useState<{
    id: string;
    text: string;
    actor?: KillFeedActor;
  } | null>(null);
  // The arena doors opening: one hard flash across the chart on COOK!.
  const [launching, setLaunching] = useState(false);
  const lastPhase = useRef<string>("");
  const positionRef = useRef<typeof position>(null);
  // Server-clock offset: countdowns must run on the server's clock, not the
  // browser's. A skewed local clock made rounds "end with time left" and the
  // pull-up jump to live before the 5-4-3-2-1 could fire. Ticker + lobby
  // messages carry serverNow; we keep the delta and add it to Date.now().
  const clockOffset = useRef(0);

  // Fresh values for the socket callback without re-subscribing.
  const liveRef = useRef(false);
  const bigEthRef = useRef(0.05);
  const myAddrRef = useRef<string | undefined>(undefined);
  const athRef = useRef(0);

  const load = useCallback(async () => {
    const data = await api<{
      round: Round;
      killfeed: KillFeedEvent[];
      trades: Trade[];
      candles: Candle[];
      predictions: { moon: number; rug: number };
      auction: AuctionResult | null;
      summary: RoundSummary | null;
      ethUsd?: number;
    }>(`/api/rounds/${id}`);
    if (data.round.matchType === "pit" && !pitRedirected.current) {
      pitRedirected.current = true;
      router.replace(`/pit/${id}`);
      return;
    }
    setRound(data.round);
    setKillfeed(data.killfeed);
    setTrades(data.trades);
    setCandles(data.candles);
    setPreds(data.predictions);
    setAuction(data.auction);
    setSummary(data.summary);
    if (data.ethUsd) setPegUsd(data.ethUsd);
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMe = useCallback(async () => {
    if (!profile) return;
    try {
      const me = await api<{
        position: { tokens: number; costBasisEth: number; realizedPnl: number };
        rug?: RugInfo | null;
        fill?: MyFill | null;
      }>(`/api/rounds/${id}/me`);
      setPosition(me.position);
      setRug(me.rug ?? null);
      setFill(me.fill ?? null);
    } catch {
      /* not signed in */
    }
  }, [id, profile]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Fresh round → the pull-up receipt is un-dismissed again.
  useEffect(() => {
    setFillDismissed(false);
    setFill(null);
  }, [id]);

  // Live per-round leaderboard while trading is open.
  useEffect(() => {
    if (round?.state !== "live") return;
    let alive = true;
    const poll = () =>
      api<{ rows: typeof leaders }>(`/api/leaderboard?scope=round&roundId=${id}`)
        .then((d) => alive && setLeaders(d.rows.slice(0, 5)))
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, round?.state]);

  // The chat console follows you: entering a match switches the dock to that
  // room's channel; leaving drops back to The Cookout.
  useEffect(() => {
    if (!round) return;
    setActiveRoom({
      id: round.id,
      label: `$${round.token.symbol}`,
      frozen: round.state === "results" || round.state === "ended",
    });
  }, [round?.id, round?.state, round?.token.symbol, setActiveRoom]);
  useEffect(() => () => setActiveRoom(null), [setActiveRoom]);

  // Phase transitions announce themselves once.
  useEffect(() => {
    if (!round) return;
    const prev = lastPhase.current;
    lastPhase.current = round.state;
    if (!prev || prev === round.state) return;
    const show = (text: string, tone: "go" | "end" | "bad") => {
      setFlash({ text, tone });
      setTimeout(() => setFlash(null), 1900);
    };
    // Lobby/pull-up/live and the verdict are announced by RoundOverlays
    // (LOBBY OPEN / PULL UP / COOK! / the verdict), so this only covers the
    // one phase it doesn't own.
    if (round.state === "settling") show("SETTLING", "end");
  }, [round?.state, round?.graduated]);

  // Ambience is off for now — the queue "low roar" bed wasn't wanted. The
  // system stays wired (audio.startAmbience) so a better bed can drop in later;
  // we just don't invoke it. Still stop any bed on leave, for safety.
  useEffect(() => () => audio.stopAmbience(), []);


  liveRef.current = round?.state === "live";
  positionRef.current = position;
  bigEthRef.current = Math.max(0.05, (ticker?.liquidity ?? round?.config.curveAnchorEth ?? 1) * 0.05);
  myAddrRef.current = profile?.address;

  useRoundSocket(id, (e) => {
    switch (e.type) {
      case "round_state":
        setRound(e.round as Round);
        if ((e.round as Round).state === "results") void refresh();
        break;
      case "candle":
        setCandles((prev) => [...prev.slice(-299), e.candle as Candle]);
        break;
      case "killfeed": {
        setKillfeed((prev) => [...prev.slice(-99), e.event as KillFeedEvent]);
        const kind = (e.event as KillFeedEvent).kind;
        if (liveRef.current) {
          if (kind === "whale_entered") {
            playWhale();
            fireFx("whale");
          } else if (kind === "rug_detected") {
            playRug();
            fireFx("rug");
            quake();
          } else if (kind === "mcap_milestone") {
            playMilestone();
            fireFx("milestone");
          } else if (kind === "new_leader") {
            playHorn();
          } else if (kind === "dev_sell") {
            // The dev selling their own coin isn't a rug — but the room should
            // see exactly who did it, so it gets the full-bleed banner.
            playThud();
            fireFx("sell");
            const ev = e.event as KillFeedEvent;
            setDevSell({ id: ev.id, text: ev.text, actor: ev.actor });
            setTimeout(() => setDevSell((d) => (d?.id === ev.id ? null : d)), 3400);
          } else if (kind === "big_sell") {
            playThud();
          } else if (kind === "graduated") {
            playFanfare();
            fireFx("graduated");
          } else if (kind === "overtime") {
            playFanfare();
            fireFx("milestone");
            const minute = Number((e.event as KillFeedEvent).meta?.minute ?? 1);
            setOvertime({ minute });
            setTimeout(() => setOvertime((o) => (o?.minute === minute ? null : o)), 3000);
          }
        }
        break;
      }
      case "reaction":
        setReactions((prev) => [...prev.slice(-15), { id: Date.now() + Math.random(), emoji: e.emoji as string }]);
        break;
      case "prediction_update":
        setPreds({ moon: e.moon as number, rug: e.rug as number });
        break;
      case "trade": {
        // seenAt drives the on-chart tooltip fade for fresh trades.
        setTrades((prev) => [
          ...prev.slice(-199),
          { ...(e.trade as Trade), seenAt: Date.now() } as Trade,
        ]);
        const t = e.trade as Trade;
        if (liveRef.current) {
          // Distant fire: everyone else's trades tick; big ones flash the sky.
          if (t.userAddress !== myAddrRef.current) playTradeTick(t.side, t.ethAmount);
          if (t.ethAmount >= bigEthRef.current) fireFx(t.side === "buy" ? "buy" : "sell");
        }
        break;
      }
      case "ticker": {
        const tk = e as unknown as Ticker;
        setTicker(tk);
        const tkNow = (tk as unknown as { serverNow?: number }).serverNow;
        if (typeof tkNow === "number") clockOffset.current = tkNow - Date.now();
        if (tk.athMcap !== undefined) {
          if (athRef.current > 0 && tk.athMcap > athRef.current * 1.001 && liveRef.current) {
            playAthSparkle();
            fireFx("ath");
          }
          athRef.current = Math.max(athRef.current, tk.athMcap);
        }
        break;
      }
      case "lobby_update": {
        setLobby(e as unknown as Lobby);
        const lbNow = (e as unknown as { serverNow?: number }).serverNow;
        if (typeof lbNow === "number") clockOffset.current = lbNow - Date.now();
        break;
      }
      case "auction_settled":
        setAuction(e.result as AuctionResult);
        void loadMe();
        void refresh();
        break;
      case "round_end": {
        const sum = (e as { summary?: RoundSummary }).summary ?? null;
        setSummary(sum);
        void refresh();
        // Rugged / non-graduated endings pop the results overlay with the
        // player's redemption breakdown: pre-end snapshot vs post-end truth.
        if (sum && !sum.graduated) {
          const pre = positionRef.current;
          void api<{ position: { tokens: number; costBasisEth: number; realizedPnl: number } }>(
            `/api/rounds/${id}/me`,
          )
            .then((me) => {
              setPosition(me.position);
              const held = pre?.tokens ?? 0;
              const invested = pre?.costBasisEth ?? 0;
              const returned =
                held > 0 ? me.position.realizedPnl - (pre?.realizedPnl ?? 0) + invested : 0;
              setResultsOpen(true);
              setEndResults({
                summary: sum,
                breakdown: pre || me.position.realizedPnl !== 0
                  ? {
                      invested,
                      heldTokens: held,
                      returned: Math.max(0, returned),
                      roundPnl: me.position.realizedPnl,
                    }
                  : null,
              });
            })
            .catch(() => {
              setResultsOpen(true);
              setEndResults({ summary: sum, breakdown: null });
            });
        } else {
          void loadMe();
        }
        break;
      }
    }
  });

  const pnl = useMemo(() => {
    if (!position) return 0;
    const price = ticker?.price ?? 0;
    return position.realizedPnl + position.tokens * price - position.costBasisEth;
  }, [position, ticker]);

  // Open the results overlay on demand. The live path already caches
  // `endResults` from the round_end event; this rebuilds it for a round you
  // arrive at already finished (from the calendar) or one that graduated —
  // so "See match results" always works, not just if you watched the bell.
  const openResults = useCallback(async () => {
    if (endResults) return setResultsOpen(true);
    if (!summary) return;
    let breakdown: EndBreakdown | null = null;
    try {
      const me = await api<{
        position: { tokens: number; costBasisEth: number; realizedPnl: number };
      }>(`/api/rounds/${id}/me`);
      setPosition(me.position);
      if (me.position.costBasisEth > 0 || me.position.realizedPnl !== 0) {
        breakdown = {
          invested: me.position.costBasisEth,
          heldTokens: me.position.tokens,
          returned: 0, // settled rounds hold no bag; redemption already realized
          roundPnl: me.position.realizedPnl,
        };
      }
    } catch {
      // Not signed in / never played — the overlay still shows the round story.
    }
    setEndResults({ summary, breakdown });
    setResultsOpen(true);
  }, [endResults, summary, id]);

  if (!round)
    return <div className="p-10 text-center text-zinc-500">Loading round…</div>;

  const myRank = profile
    ? (() => {
        const i = leaders.findIndex(
          (l) => l.address.toLowerCase() === profile.address.toLowerCase(),
        );
        return i === -1 ? null : i + 1;
      })()
    : null;
  const teaser = round.state === "scheduled";
  const spectating = round.state === "live" && (!position || position.tokens === 0);
  const unit = round.chain ? "ETH" : "pETH";

  return (
    <div className="relative space-y-3">
      <FloatingReactions reactions={reactions} />
      {/* The Fair Open receipt pops in as a corner toast (like an achievement),
          never in the trade column, so it can't shift the deck. */}
      {fill && !fillDismissed && (round.state === "live" || round.graduated) && (
        <PullUpReceipt
          fill={fill}
          unit={unit}
          ethUsd={ticker?.ethUsd ?? pegUsd}
          onClose={() => setFillDismissed(true)}
        />
      )}
      {overtime && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="animate-[bannerIn_.35s_cubic-bezier(.2,1.5,.4,1)] text-center"
            style={{ animationFillMode: "both" }}
          >
            <div className="text-6xl font-black tracking-tight text-sky-300 drop-shadow-[0_0_30px_rgba(56,189,248,0.6)] md:text-8xl">
              ⏱️ OVERTIME
            </div>
            <div className="mt-2 text-2xl font-black text-sky-200 md:text-3xl">
              +1:00 on the clock · the coin&apos;s still cooking
              {overtime.minute > 1 && (
                <span className="ml-2 rounded-full bg-sky-400/20 px-2 py-0.5 text-base align-middle">
                  x{overtime.minute}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {devSell && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="animate-[bannerIn_.35s_cubic-bezier(.2,1.5,.4,1)] flex max-w-[92vw] flex-col items-center text-center"
            style={{ animationFillMode: "both" }}
          >
            {devSell.actor && (
              <ActorFace actor={devSell.actor} size={96} ring="ring-2 ring-orange-400" />
            )}
            <div className="mt-3 text-4xl font-black tracking-tight text-orange-300 drop-shadow-[0_0_30px_rgba(251,146,60,0.6)] md:text-6xl">
              ⚠️ DEV SOLD
            </div>
            <div className="mt-1 text-xl font-black text-orange-100 md:text-2xl">
              {devSell.actor?.displayName ?? "The dev"}
            </div>
            <div className="mt-1 max-w-xl text-sm font-bold text-zinc-300 md:text-base">
              {devSell.text}
            </div>
          </div>
        </div>
      )}
      {endResults && resultsOpen && (
        <RoundResultsOverlay
          summary={endResults.summary}
          symbol={round.token.symbol}
          artworkUrl={round.token.artworkUrl}
          creatorAddress={round.creatorAddress}
          shareName={
            profile?.displayName ??
            (profile ? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}` : undefined)
          }
          unit={unit}
          ethUsd={ticker?.ethUsd ?? 1925}
          breakdown={endResults.breakdown}
          onChain={!!round.chain}
          onClose={() => setResultsOpen(false)}
        />
      )}
      {/* The announcer: countdowns, MARKET OPEN, the final ten, the verdict. */}
      <RoundOverlays round={round} onCook={onCook} nowOffset={clockOffset.current} />
      {/* The welcome mat: fires once, after their very first match settles. */}
      <FirstMatchCelebration round={round} />
      {(round.state === "results" || round.state === "ended") && (
        <button
          onClick={() => void openResults()}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition ${
            round.graduated
              ? "border-lime-400/50 bg-lime-400/10 text-lime-300 hover:bg-lime-400/20"
              : isRugRound(round)
                ? "border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500"
          }`}
        >
          {round.graduated ? "🍽️" : isRugRound(round) ? "🔥" : "📊"} See match results
          <span className="font-normal opacity-70">
            {round.graduated ? "· how the pre-bond battle played out" : "· PnL & payouts"}
          </span>
        </button>
      )}
      <ArenaHeader
        round={round}
        ticker={ticker}
        position={position}
        rank={myRank}
        players={lobby?.players}
        nowOffset={clockOffset.current}
      />
      <EventStrip killfeed={killfeed} since={round.liveAt} live={round.state === "live"} />
      {/* ---- pre-launch arcade: everything on one screen ---- */}
      {(round.state === "lobby" || round.state === "queue_open" || round.state === "settling") && (
        <div className="grid gap-3 lg:min-h-[34rem]">
          <div className={`min-h-0 space-y-3 overflow-y-auto rounded-xl ${round.state === "queue_open" ? "neon" : ""}`}>
            <ArenaWalletPanel round={round} />
            <QueuePanel
              round={round}
              lobby={lobby}
              preds={preds}
              ethUsd={ticker?.ethUsd ?? pegUsd}
              onChanged={() => {
                void loadMe();
                void refresh();
              }}
            />
          </div>
        </div>
      )}

      {(round.state === "live" || round.state === "ended" || round.state === "results") && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* min-w-0 lets the column shrink below the canvas's intrinsic width
              on mobile — without it the chart overflows the viewport. */}
          <div className="relative min-w-0">
            {/* Kept OUT of the space-y flow below: its flashes are absolute, but
                as direct children of a space-y container their changing count
                flipped the top-margin on the next element and bounced the whole
                deck on every flash. As a positioned overlay it can't. */}
            <BattleFX events={fx} />
            <div className="space-y-4">
            {round.state === "live" && ticker && (
              <GraduationProgress
                config={round.config}
                ticker={ticker}
                onMilestone={(pct) =>
                  setKillfeed((f) => [
                    ...f,
                    {
                      id: `bond-${pct}-${Date.now()}`,
                      roundId: round.id,
                      kind: "mcap_milestone",
                      text: `Bonding passed ${pct}%`,
                      at: Date.now(),
                    },
                  ])
                }
              />
            )}
            <div className={`relative ${shake ? "fx-shake" : ""}`}>
              <EdgeCallouts killfeed={killfeed} />
              <UrgencyPulse
                endsAt={round.endsAt}
                active={round.state === "live"}
                nowOffset={clockOffset.current}
              />
              {launching && <div className="launch-flash" />}
              {flash && <PhaseFlash text={flash.text} tone={flash.tone} />}
              <Chart
              candles={candles}
              trades={trades}
              livePrice={ticker?.price}
              openPrice={round.clearingPrice}
              supply={round.config.totalSupply}
              bigTradeEth={Math.max(0.05, (ticker?.liquidity ?? round.config.curveAnchorEth) * 0.05)}
              cooking={ticker?.cooking}
              ethUsd={ticker?.ethUsd}
              highlightAddress={profile?.address}
              phase={round.state}
              liveAt={round.liveAt}
              liquidity={ticker?.liquidity}
              // Edge callouts carry the trade story now, so nothing sits on
              // top of the candles during a live round.
              bubbleLabels={false}
              // Served-up coins keep trading — no end overlay, live chart stays.
              endReason={round.graduated ? undefined : round.endReason}
              graduated={round.graduated}
              />
            </div>
            {/* Rug meter — the dev's dump-to-rug gauge, right on the trade deck.
                Only the creator ever receives `rug`, so this is theirs alone. */}
            {round.state === "live" && rug && <RugMeter rug={rug} blitz={round.blitz} />}
            {round.state === "live" && (
              <TradePanel
                round={round}
                position={position}
                ethUsd={ticker?.ethUsd ?? pegUsd ?? 1925}
                price={ticker?.price}
                variant="bar"
                onTraded={() => {
                  void loadMe();
                  void refresh();
                }}
              />
            )}
            {/* The order book sits under the buttons and survives the round —
                it keeps rendering the trade tape for graduated and burnt coins. */}
            <OrderBook
              trades={trades}
              symbol={round.token.symbol}
              ethUsd={ticker?.ethUsd ?? pegUsd ?? 1925}
              me={profile?.address}
            />
            <ChainActions
              round={round}
              onChanged={() => {
                void loadMe();
                void refresh();
              }}
            />
            {summary && <Results round={round} summary={summary} auction={auction} />}
            </div>
          </div>
          {/* The social column: gameplay lives on the left, the crowd on the
              right — chat, who's winning, who's holding — all visible at once. */}
          <div className="min-w-0 space-y-4">
            {round.graduated && !round.chain && (
              <TradePanel
                round={round}
                position={position}
                ethUsd={ticker?.ethUsd}
                variant="widget"
                onTraded={() => {
                  void loadMe();
                  void refresh();
                }}
              />
            )}
            <ArenaWalletPanel round={round} />
            {(round.state === "live" || round.graduated) && position && ticker && (
              <YourBag
                position={position}
                price={ticker.price}
                ethUsd={ticker.ethUsd ?? 1925}
                symbol={round.token.symbol}
                artworkUrl={round.token.artworkUrl}
                shareName={
                  profile?.displayName ??
                  (profile ? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}` : undefined)
                }
                onSellAll={() => {
                  const run = async () => {
                    if (round.chain) {
                      const bal = await walletTokenBalanceWei(round);
                      if (bal > 0n) await chainSell(round, bal);
                    } else {
                      await api(`/api/rounds/${round.id}/trade`, {
                        body: { side: "sell", pct: 100 },
                      });
                    }
                    playSell();
                    void loadMe();
                    void refresh();
                  };
                  void run().catch(() => {});
                }}
              />
            )}
            <TopHolders roundId={round.id} ethUsd={ticker?.ethUsd} />
            {(round.state === "live" || round.state === "results") && (
              <LiveLeaders rows={leaders} me={profile?.address} ethUsd={ticker?.ethUsd} />
            )}
          </div>
        </div>
      )}

      {auction && round.state !== "results" && (
        <div className="rounded-lg bg-zinc-900/40 px-4 py-2 text-xs text-zinc-500">
          Auction settled at {auction.clearingPrice.toExponential(4)} · raised{" "}
          {auction.totalRaised.toFixed(2)} {unit} from {auction.fills.length} intents (fill ratio{" "}
          {(auction.fillRatio * 100).toFixed(0)}%) · audit {auction.auditHash.slice(0, 16)}…
        </div>
      )}
    </div>
  );
}

/**
 * Your Fair Open receipt — shown over the trade deck the moment a round opens so
 * a partial fill is obvious right then, not just later in the wallet ledger. The
 * open is a capped batch auction: when the pull is oversubscribed, everyone
 * fills pro-rata and the rest is refunded. A full fill gets a short confirm; a
 * partial fill spells out committed → cleared (ratio) with the refund called out.
 */
function PullUpReceipt({
  fill,
  unit,
  ethUsd,
  onClose,
}: {
  fill: MyFill;
  unit: string;
  ethUsd?: number;
  onClose: () => void;
}) {
  const partial = fill.ratio < 0.995;
  const pct = Math.round(fill.ratio * 100);
  // Freeze the peg the first time we can: the fill already happened, so its
  // numbers are static (no re-converting on every ticker tick).
  const pegRef = useRef<number | undefined>(undefined);
  if (pegRef.current === undefined && ethUsd) pegRef.current = ethUsd;
  const peg = pegRef.current;
  const money = (eth: number) =>
    peg ? `$${(eth * peg).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${eth.toFixed(4)} ${unit}`;

  // Console-style toast: slide in, linger, then fade and dismiss itself.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = window.setTimeout(() => setLeaving(true), partial ? 12000 : 7000);
    const t2 = window.setTimeout(onClose, (partial ? 12000 : 7000) + 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [partial, onClose]);

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 w-80 max-w-[calc(100vw-2rem)]">
      <div
        className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-zinc-950/95 px-4 py-3 text-sm shadow-2xl shadow-black/60 backdrop-blur transition-all duration-700 ${
          leaving ? "translate-x-6 opacity-0" : "translate-x-0 opacity-100 animate-[fadein_.3s_ease]"
        } ${partial ? "border-amber-400/50" : "border-lime-400/50"}`}
      >
        <span className="text-lg leading-none">🚪</span>
        <div className="min-w-0 flex-1">
          {partial ? (
            <>
              <div className="font-bold text-amber-200">
                Your pull-up cleared {pct}% at the fair open.
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-zinc-300">
                You pulled up <b>{money(fill.committedEth)}</b>; <b>{money(fill.filledEth)}</b> went
                into your position and <b>{money(fill.refundEth)}</b> came back to your Cook Out
                balance. The open is a capped auction, so an oversubscribed pull fills pro-rata.
              </div>
            </>
          ) : (
            <div className="font-bold text-lime-200">
              Your pull-up cleared in full. <b>{money(fill.filledEth)}</b> went into your position.
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-zinc-500 hover:text-zinc-200"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Unrealized P&L panel (pump.fun style): big signed dollar figure, a
 *  percentage pill, a value-vs-cost bar, holdings + cost basis, Sell All
 *  and a Share that copies a flex line to the clipboard. */
function YourBag({
  position,
  price,
  ethUsd,
  symbol,
  artworkUrl,
  onSellAll,
  shareName,
}: {
  position: { tokens: number; costBasisEth: number; realizedPnl: number };
  price: number;
  ethUsd: number;
  symbol: string;
  artworkUrl?: string;
  onSellAll?: () => void;
  shareName?: string;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const valueEth = position.tokens * price;
  const unreal = valueEth - position.costBasisEth;
  const unrealUsd = unreal * ethUsd;
  const pct = position.costBasisEth > 0 ? (unreal / position.costBasisEth) * 100 : 0;
  const up = unreal >= 0;
  const tone = up ? "text-emerald-400" : "text-red-400";

  // Live PnL sparkline (pump.fun style): sample the unrealized P&L twice a
  // second and draw it as a line — green above breakeven, red below.
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const pnlNowRef = useRef(unrealUsd);
  pnlNowRef.current = unrealUsd;
  const historyRef = useRef<number[]>([]);
  useEffect(() => {
    const t = setInterval(() => {
      const h = historyRef.current;
      h.push(pnlNowRef.current);
      if (h.length > 240) h.splice(0, h.length - 240); // ~2 minutes of history

      const canvas = sparkRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, ch);
      if (h.length < 2) return;

      let lo = Math.min(0, ...h);
      let hi = Math.max(0, ...h);
      if (hi === lo) {
        hi += 1;
        lo -= 1;
      }
      const pad = (hi - lo) * 0.12;
      hi += pad;
      lo -= pad;
      const xAt = (i: number) => (i / (h.length - 1)) * w;
      const yAt = (v: number) => ch - ((v - lo) / (hi - lo)) * ch;

      // Faint breakeven line.
      const zy = yAt(0);
      ctx.strokeStyle = "#3f3f46";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zy);
      ctx.lineTo(w, zy);
      ctx.stroke();
      ctx.setLineDash([]);

      // The PnL line, colored by sign per segment.
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      for (let i = 1; i < h.length; i++) {
        ctx.strokeStyle = (h[i]! + h[i - 1]!) / 2 >= 0 ? "#34d399" : "#f87171";
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), yAt(h[i - 1]!));
        ctx.lineTo(xAt(i), yAt(h[i]!));
        ctx.stroke();
      }
      // Glowing endpoint on the latest sample.
      const last = h[h.length - 1]!;
      ctx.fillStyle = last >= 0 ? "#34d399" : "#f87171";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(w - 1.5, yAt(last), 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }, 500);
    return () => clearInterval(t);
  }, []);

  const fmtUsd = (v: number) =>
    `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(2) + "k" : Math.abs(v).toFixed(2)}`;
  const fmtTokens = (t: number) =>
    t >= 1_000_000 ? `${(t / 1_000_000).toFixed(2)}M` : t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t.toFixed(2);



  return (
    <div className="rounded-2xl bg-zinc-900/70 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          Unrealized P&amp;L <span className="text-zinc-700">●</span>
        </span>
        {onSellAll && position.tokens > 0 && (
          <button
            onClick={onSellAll}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-black text-white hover:bg-red-500 active:scale-95"
          >
            Sell All
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className={`font-mono text-3xl font-black tracking-tight ${tone}`}>
          {up ? "+" : ""}
          {fmtUsd(unrealUsd)}
        </span>
        <span
          className={`rounded-md px-2 py-1 font-mono text-xs font-bold ${
            up ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
          }`}
        >
          {up ? "↑" : "↓"} {Math.abs(pct) >= 1000 ? Math.abs(pct).toFixed(0) : Math.abs(pct).toFixed(2)}%
        </span>
      </div>
      <canvas ref={sparkRef} className="mt-3 h-9 w-full" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-mono font-bold text-zinc-200">
          {fmtTokens(position.tokens)} {symbol}
          <span className="ml-1.5 text-zinc-500">·</span>
          <span className="ml-1.5 text-zinc-300">{fmtUsd(valueEth * ethUsd)}</span>
        </span>
        <span className="text-xs text-zinc-500">
          Cost basis <span className="font-mono font-bold text-zinc-300">{fmtUsd(position.costBasisEth * ethUsd)}</span>
        </span>
        <button
          onClick={() => setShareOpen(true)}
          className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30"
        >
          ➦ Share
        </button>
      </div>
      {shareOpen && (
        <PnlShareCard
          onClose={() => setShareOpen(false)}
          data={{
            symbol,
            artworkUrl,
            pct,
            pnlUsd: unrealUsd,
            valueUsd: valueEth * ethUsd,
            costUsd: position.costBasisEth * ethUsd,
            name: shareName,
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="text-sm">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`font-mono font-bold ${
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
