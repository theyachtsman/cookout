"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type {
  AuctionResult,
  Candle,
  ChatMessage,
  KillFeedEvent,
  Round,
  RoundSummary,
  Trade,
} from "@cookout/shared";
import { api } from "../../../lib/api";
import { chainSell, walletTokenBalanceWei } from "../../../lib/chainTx";
import { playAthSparkle, playFanfare, playHorn, playMilestone, playRug, playSell, playThud, playTradeTick, playWhale } from "../../../lib/sfx";
import { useSession } from "../../../lib/session";
import { useRoundSocket } from "../../../lib/useRoundSocket";
import { FloatingReactions, KillFeedTicker } from "../../../components/ArcadeOverlays";
import { Chart } from "../../../components/Chart";
import { Chat } from "../../../components/Chat";
import { TopHolders } from "../../../components/TopHolders";
import { Countdown } from "../../../components/Countdown";
import { GraduationProgress } from "../../../components/GraduationProgress";
import { BattleFX, type FxEvent, type FxKind } from "../../../components/BattleFX";
import { PhaseBanner } from "../../../components/PhaseBanner";
import { PnlShareCard } from "../../../components/PnlShareCard";
import { ArenaWalletPanel } from "../../../components/ArenaWalletPanel";
import { ChainActions } from "../../../components/ChainActions";
import { QueuePanel } from "../../../components/QueuePanel";
import { Results } from "../../../components/Results";
import { TradePanel } from "../../../components/TradePanel";

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

export default function RoundPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, refresh } = useSession();
  const [round, setRound] = useState<Round | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [killfeed, setKillfeed] = useState<KillFeedEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [auction, setAuction] = useState<AuctionResult | null>(null);
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [preds, setPreds] = useState<{ moon: number; rug: number }>({ moon: 0, rug: 0 });
  const [reactions, setReactions] = useState<Array<{ id: number; emoji: string }>>([]);
  const [leaders, setLeaders] = useState<Array<{ address: string; displayName?: string; badge?: string; value: number }>>([]);
  const [position, setPosition] = useState<{ tokens: number; costBasisEth: number; realizedPnl: number } | null>(null);

  // ---- battle FX: flashes/shockwaves + soundscape driven by WS events ----
  const [fx, setFx] = useState<FxEvent[]>([]);
  const [shake, setShake] = useState(false);
  const fireFx = useCallback((kind: FxKind) => {
    const id = Date.now() + Math.random();
    setFx((list) => [...list.slice(-8), { id, kind }]);
    setTimeout(() => setFx((list) => list.filter((f) => f.id !== id)), 1100);
  }, []);
  const quake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 650);
  }, []);
  // Fresh values for the socket callback without re-subscribing.
  const liveRef = useRef(false);
  const bigEthRef = useRef(0.05);
  const myAddrRef = useRef<string | undefined>(undefined);
  const athRef = useRef(0);

  const load = useCallback(async () => {
    const data = await api<{
      round: Round;
      killfeed: KillFeedEvent[];
      chat: ChatMessage[];
      trades: Trade[];
      candles: Candle[];
      predictions: { moon: number; rug: number };
      auction: AuctionResult | null;
      summary: RoundSummary | null;
    }>(`/api/rounds/${id}`);
    setRound(data.round);
    setKillfeed(data.killfeed);
    setChat(data.chat);
    setTrades(data.trades);
    setCandles(data.candles);
    setPreds(data.predictions);
    setAuction(data.auction);
    setSummary(data.summary);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMe = useCallback(async () => {
    if (!profile) return;
    try {
      const me = await api<{ position: { tokens: number; costBasisEth: number; realizedPnl: number } }>(
        `/api/rounds/${id}/me`,
      );
      setPosition(me.position);
    } catch {
      /* not signed in */
    }
  }, [id, profile]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

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

  liveRef.current = round?.state === "live";
  bigEthRef.current = Math.max(0.05, (ticker?.liquidity ?? round?.config.initialEthLiquidity ?? 1) * 0.05);
  myAddrRef.current = profile?.address;

  const { sendChat, sendReact } = useRoundSocket(id, (e) => {
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
          } else if (kind === "big_sell" || kind === "dev_sell") {
            playThud();
          } else if (kind === "graduated") {
            playFanfare();
            fireFx("graduated");
          }
        }
        break;
      }
      case "chat":
        setChat((prev) => [...prev.slice(-199), e.message as ChatMessage]);
        break;
      case "chat_delete":
        setChat((prev) => prev.filter((m) => m.id !== (e.messageId as string)));
        break;
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
        if (tk.athMcap !== undefined) {
          if (athRef.current > 0 && tk.athMcap > athRef.current * 1.001 && liveRef.current) {
            playAthSparkle();
            fireFx("ath");
          }
          athRef.current = Math.max(athRef.current, tk.athMcap);
        }
        break;
      }
      case "lobby_update":
        setLobby(e as unknown as Lobby);
        break;
      case "auction_settled":
        setAuction(e.result as AuctionResult);
        void loadMe();
        void refresh();
        break;
      case "round_end":
        setSummary((e as { summary?: RoundSummary }).summary ?? null);
        void refresh();
        void loadMe();
        break;
    }
  });

  const pnl = useMemo(() => {
    if (!position) return 0;
    const price = ticker?.price ?? 0;
    return position.realizedPnl + position.tokens * price - position.costBasisEth;
  }, [position, ticker]);

  if (!round)
    return <div className="p-10 text-center text-zinc-500">Loading round…</div>;

  const teaser = round.state === "scheduled";
  const spectating = round.state === "live" && (!position || position.tokens === 0);
  const unit = round.chain ? "ETH" : "pETH";

  return (
    <div className="relative space-y-3">
      <FloatingReactions reactions={reactions} />
      <PhaseBanner round={round} />
      <KillFeedTicker killfeed={killfeed} />
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3">
        <div className="flex items-center gap-3">
          {round.token.artworkUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={round.token.artworkUrl}
              alt=""
              className={`h-10 w-10 rounded-lg border border-zinc-700 object-cover ${teaser ? "blur-md" : ""}`}
            />
          )}
          <span className="text-xl font-black">{teaser ? "???" : round.token.name}</span>{" "}
          {!teaser && <span className="text-zinc-500">${round.token.symbol}</span>}
          <span className="ml-3 rounded bg-zinc-800 px-1.5 py-0.5 text-xs uppercase text-zinc-300">
            {round.tier}
          </span>
          {round.chain && (
            <span
              className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-xs font-bold text-amber-300"
              title={`pool ${round.chain.pool} on chain ${round.chain.chainId}`}
            >
              ⛓️ ON-CHAIN
            </span>
          )}
          {spectating && (
            <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-300">
              spectating
            </span>
          )}
        </div>
        {ticker && round.state === "live" && (
          <>
            {ticker.cooking && (
              <span className="animate-pulse rounded bg-orange-500/20 px-2 py-1 text-xs font-black text-orange-300">
                🔥 Cooking
              </span>
            )}
            <Stat
              label="Market Cap"
              value={`$${((ticker.mcap * (ticker.ethUsd ?? 1925)) / 1000).toFixed(1)}k`}
            />
            {ticker.athMcap !== undefined && (
              <Stat
                label="ATH"
                value={`$${((ticker.athMcap * (ticker.ethUsd ?? 1925)) / 1000).toFixed(1)}k${
                  ticker.mcap >= ticker.athMcap * 0.98 ? " 🚀" : ""
                }`}
                tone={ticker.mcap >= ticker.athMcap * 0.98 ? "up" : undefined}
              />
            )}
            <Stat label="Liquidity" value={`${ticker.liquidity.toFixed(1)} ${unit}`} />
            <Stat label="Volume" value={`${ticker.volume.toFixed(2)} ${unit}`} />
            <Stat label="Age" value={`${ticker.ageSeconds}s`} />
            <Stat label="Holders" value={String(ticker.holders)} />
            <Stat
              label="Your PnL"
              value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(3)} ${unit}`}
              tone={pnl >= 0 ? "up" : "down"}
            />
          </>
        )}
        {round.state === "live" && round.endsAt && (
          <div className="text-sm text-zinc-400">
            max timer <Countdown to={round.endsAt} />
          </div>
        )}
      </div>

      {/* ---- pre-launch arcade: everything on one screen ---- */}
      {(round.state === "lobby" || round.state === "queue_open" || round.state === "settling") && (
        <div className="grid gap-3 lg:h-[calc(100dvh-16rem)] lg:min-h-[34rem] lg:grid-cols-[1fr_340px]">
          <div className={`min-h-0 space-y-3 overflow-y-auto rounded-xl ${round.state === "queue_open" ? "neon" : ""}`}>
            {round.chain && <ArenaWalletPanel round={round} />}
            <QueuePanel
              round={round}
              lobby={lobby}
              preds={preds}
              onChanged={() => {
                void loadMe();
                void refresh();
              }}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            {/* the token card lived here; the top bar already names the round —
                the trenches get the full column */}
            <div className="min-h-0 flex-1">
              <Chat messages={chat} onSend={sendChat} onReact={sendReact} reactions={reactions} />
            </div>
          </div>
        </div>
      )}

      {(round.state === "live" || round.state === "ended" || round.state === "results") && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className={`relative space-y-4 ${shake ? "fx-shake" : ""}`}>
            <BattleFX events={fx} />
            {round.state === "live" && ticker && (
              <GraduationProgress config={round.config} ticker={ticker} />
            )}
            <Chart
              candles={candles}
              trades={trades}
              livePrice={ticker?.price}
              openPrice={round.clearingPrice}
              supply={round.config.totalSupply}
              bigTradeEth={Math.max(0.05, (ticker?.liquidity ?? round.config.initialEthLiquidity) * 0.05)}
              cooking={ticker?.cooking}
              ethUsd={ticker?.ethUsd}
              highlightAddress={profile?.address}
              // Served-up coins keep trading — no end overlay, live chart stays.
              endReason={round.graduated ? undefined : round.endReason}
              graduated={round.graduated}
            />
            {/* the trenches — fixed-height console chat right under the chart */}
            <div className="h-64">
              <Chat messages={chat} onSend={sendChat} onReact={sendReact} reactions={reactions} />
            </div>
            <ChainActions
              round={round}
              onChanged={() => {
                void loadMe();
                void refresh();
              }}
            />
            {summary && <Results round={round} summary={summary} auction={auction} />}
          </div>
          <div className="space-y-4">
            {/* pump-style layout: the trade widget leads the right column */}
            {(round.state === "live" || (round.graduated && !round.chain)) && (
              <TradePanel
                round={round}
                position={position}
                onTraded={() => {
                  void loadMe();
                  void refresh();
                }}
              />
            )}
            {round.chain && <ArenaWalletPanel round={round} />}
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
            {round.state === "live" && leaders.length > 0 && (
              <div className="rounded-xl border border-zinc-800 p-4">
                <h4 className="mb-2 text-sm font-bold text-zinc-300">Round Leaders</h4>
                <div className="space-y-1 text-sm">
                  {leaders.map((l, i) => (
                    <a
                      key={l.address}
                      href={`/profile/${l.address}`}
                      className="flex justify-between rounded bg-zinc-900 px-2 py-1 hover:bg-zinc-800"
                    >
                      <span>
                        <span className="mr-1.5 font-mono text-zinc-500">{i + 1}</span>
                        {l.badge && <span className="mr-1">{l.badge}</span>}
                        {l.displayName ?? `${l.address.slice(0, 6)}…${l.address.slice(-4)}`}
                      </span>
                      <span className={`font-mono ${l.value >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {l.value >= 0 ? "+" : ""}
                        {l.value.toFixed(3)}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {auction && round.state !== "results" && (
        <div className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          Auction settled at {auction.clearingPrice.toExponential(4)} — raised{" "}
          {auction.totalRaised.toFixed(2)} {unit} from {auction.fills.length} intents (fill ratio{" "}
          {(auction.fillRatio * 100).toFixed(0)}%) · audit {auction.auditHash.slice(0, 16)}…
        </div>
      )}
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
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
