"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useSession } from "../../../lib/session";
import { useRoundSocket } from "../../../lib/useRoundSocket";
import { FloatingReactions, KillFeedTicker } from "../../../components/ArcadeOverlays";
import { Chart } from "../../../components/Chart";
import { Chat } from "../../../components/Chat";
import { TopHolders } from "../../../components/TopHolders";
import { Countdown } from "../../../components/Countdown";
import { Feeds } from "../../../components/Feeds";
import { GraduationProgress } from "../../../components/GraduationProgress";
import { PhaseBanner } from "../../../components/PhaseBanner";
import { QueuePanel } from "../../../components/QueuePanel";
import { Results } from "../../../components/Results";
import { TradePanel } from "../../../components/TradePanel";

interface Ticker {
  price: number;
  mcap: number;
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

  const { sendChat, sendReact } = useRoundSocket(id, (e) => {
    switch (e.type) {
      case "round_state":
        setRound(e.round as Round);
        if ((e.round as Round).state === "results") void refresh();
        break;
      case "candle":
        setCandles((prev) => [...prev.slice(-299), e.candle as Candle]);
        break;
      case "killfeed":
        setKillfeed((prev) => [...prev.slice(-99), e.event as KillFeedEvent]);
        break;
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
      case "trade":
        // seenAt drives the on-chart tooltip fade for fresh trades.
        setTrades((prev) => [
          ...prev.slice(-199),
          { ...(e.trade as Trade), seenAt: Date.now() } as Trade,
        ]);
        break;
      case "ticker":
        setTicker(e as unknown as Ticker);
        break;
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
            <Stat label="Liquidity" value={`${ticker.liquidity.toFixed(1)} pETH`} />
            <Stat label="Volume" value={`${ticker.volume.toFixed(2)} pETH`} />
            <Stat label="Age" value={`${ticker.ageSeconds}s`} />
            <Stat label="Holders" value={String(ticker.holders)} />
            <Stat
              label="Your PnL"
              value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(3)} pETH`}
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
          <div className={`min-h-0 overflow-y-auto rounded-xl ${round.state === "queue_open" ? "neon" : ""}`}>
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
            <div className="scanlines flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
              {round.token.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={round.token.artworkUrl}
                  alt=""
                  className="h-12 w-12 rounded-xl border border-zinc-700 object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-xl">
                  🪙
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate font-black">
                  {round.token.name} <span className="text-zinc-500">${round.token.symbol}</span>
                </div>
                <div className="truncate text-xs text-zinc-400">{round.token.theme}</div>
              </div>
              <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-xs uppercase">
                {round.tier}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <Chat messages={chat} onSend={sendChat} onReact={sendReact} reactions={reactions} />
            </div>
          </div>
        </div>
      )}

      {(round.state === "live" || round.state === "ended" || round.state === "results") && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
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
              // Served-up coins keep trading — no end overlay, live chart stays.
              endReason={round.graduated ? undefined : round.endReason}
              graduated={round.graduated}
            />
            {(round.state === "live" || round.graduated) && (
              <TradePanel
                roundId={round.id}
                position={position}
                onTraded={() => {
                  void loadMe();
                  void refresh();
                }}
              />
            )}
            {/* fixed-height console-style chat so it shares the screen with the chart */}
            <div className="h-64">
              <Chat messages={chat} onSend={sendChat} onReact={sendReact} reactions={reactions} />
            </div>
            {summary && <Results round={round} summary={summary} auction={auction} />}
          </div>
          <div className="space-y-4">
            {(round.state === "live" || round.graduated) && position && ticker && (
              <YourBag
                position={position}
                price={ticker.price}
                ethUsd={ticker.ethUsd ?? 1925}
                symbol={round.token.symbol}
                balance={profile?.paperBalance}
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
            <Feeds killfeed={killfeed} trades={trades} />
          </div>
        </div>
      )}

      {auction && round.state !== "results" && (
        <div className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          Auction settled at {auction.clearingPrice.toExponential(4)} — raised{" "}
          {auction.totalRaised.toFixed(2)} pETH from {auction.fills.length} intents (fill ratio{" "}
          {(auction.fillRatio * 100).toFixed(0)}%) · audit {auction.auditHash.slice(0, 16)}…
        </div>
      )}
    </div>
  );
}

/** The player's running bag: coin balance + ETH/USD value + cash left. */
function YourBag({
  position,
  price,
  ethUsd,
  symbol,
  balance,
}: {
  position: { tokens: number; costBasisEth: number; realizedPnl: number };
  price: number;
  ethUsd: number;
  symbol: string;
  balance?: number;
}) {
  const valueEth = position.tokens * price;
  const pnl = position.realizedPnl + valueEth - position.costBasisEth;
  return (
    <div className="neon scanlines rounded-xl border border-lime-400/40 bg-zinc-900/60 p-4">
      <h4 className="mb-2 text-sm font-black tracking-wide text-lime-300">💰 YOUR BAG</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">${symbol} held</div>
          <div className="font-mono font-bold">
            {position.tokens >= 1000
              ? `${(position.tokens / 1000).toFixed(1)}k`
              : position.tokens.toFixed(0)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Bag value</div>
          <div className="font-mono font-bold">
            ${(valueEth * ethUsd).toFixed(2)}
            <span className="ml-1 text-[10px] text-zinc-500">{valueEth.toFixed(4)} pETH</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Round PnL</div>
          <div className={`font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}${(pnl * ethUsd).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Cash left</div>
          <div className="font-mono font-bold">
            {balance !== undefined ? (
              <>
                {balance.toFixed(3)} <span className="text-[10px] text-zinc-500">pETH</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>
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
