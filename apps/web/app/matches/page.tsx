"use client";

import Link from "next/link";
import { CoinCard, ModeChip, OverTimeChip } from "../../components/CoinCard";
import { useEffect, useMemo, useRef, useState } from "react";
import { GAME_MODES, marketCap, type GameMode, type Round } from "@cookout/shared";
import { api } from "../../lib/api";
import { audio } from "../../lib/audio";
import { Countdown } from "../../components/Countdown";
import { RunItBackButton } from "../../components/RunItBack";
import { TierChip } from "../../components/TierChip";
import { CategoryShelf } from "../../components/CategoryShelf";
import { useEthUsd } from "../../lib/ethUsd";
import { useSocial } from "../../lib/social";

/** In-progress-ish states: opening (pre-live) through live. */
const ACTIVE_STATES = ["lobby", "queue_open", "settling", "live"];
/** Order the queue so the closest-to-trading rounds lead. */
const STATE_ORDER: Record<string, number> = {
  live: 0,
  settling: 1,
  queue_open: 2,
  lobby: 3,
  scheduled: 4,
};

type ResultFilter = "all" | "graduated" | "failed" | "burnt";
type GroupBy = "mode" | "modifier";
type SortBy = "newest" | "graduated" | "mcap";

const isRug = (r: Round) => r.endReason === "rug_detected" || r.endReason === "liquidity_removed";
const mcapOf = (r: Round) => (r.pool ? marketCap(r.pool) : 0);
const endedTs = (r: Round) => r.endedAt ?? r.scheduledAt;

/** One emoji per mode so shelves read at a glance (distinct from each other). */
const MODE_ICON: Record<GameMode, string> = {
  classic: "🍳",
  pressure: "🔥",
  blitz: "⚡",
  reflex: "💨",
  endurance: "🕛",
};

export default function Home() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("mode");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const { setActiveRoom } = useSocial();
  // The calendar has no chat of its own — you're in the global Cookout chat
  // while browsing it. Clear any match room left over from where you came from.
  useEffect(() => {
    setActiveRoom(null);
  }, [setActiveRoom]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Round[]>("/api/calendar")
        .then((r) => alive && setRounds(r))
        .catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const active = rounds.filter((r) => ACTIVE_STATES.includes(r.state));
  const scheduled = rounds.filter((r) => r.state === "scheduled");

  // The featured slot: a truly-live round (hottest by market cap) wins; else the
  // nearest opening round; else the soonest scheduled teaser.
  const hero = useMemo(() => {
    const liveNow = active.filter((r) => r.state === "live").sort((a, b) => mcapOf(b) - mcapOf(a));
    if (liveNow[0]) return liveNow[0];
    const opening = active
      .filter((r) => r.state !== "live")
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    if (opening[0]) return opening[0];
    return [...scheduled].sort((a, b) => a.scheduledAt - b.scheduledAt)[0] ?? null;
  }, [active, scheduled]);

  // Everything else waiting to cook, closest-to-trading first — the Up Next row.
  const queue = useMemo(
    () =>
      [...active, ...scheduled]
        .filter((r) => r.id !== hero?.id)
        .sort(
          (a, b) =>
            (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) ||
            a.scheduledAt - b.scheduledAt,
        ),
    [active, scheduled, hero],
  );

  const finished = useMemo(
    () => rounds.filter((r) => r.state === "results" || r.state === "ended"),
    [rounds],
  );
  const counts = useMemo(
    () => ({
      all: finished.length,
      graduated: finished.filter((r) => r.graduated).length,
      failed: finished.filter((r) => !r.graduated).length,
      burnt: finished.filter((r) => !r.graduated && isRug(r)).length,
    }),
    [finished],
  );

  // Result filter first (cross-cutting), then split into categories.
  const visible = useMemo(
    () =>
      finished.filter((r) =>
        filter === "all"
          ? true
          : filter === "graduated"
            ? r.graduated
            : filter === "burnt"
              ? !r.graduated && isRug(r)
              : !r.graduated,
      ),
    [finished, filter],
  );

  const sortRounds = useMemo(() => {
    return (list: Round[]) =>
      [...list].sort((a, b) => {
        if (sortBy === "mcap") return mcapOf(b) - mcapOf(a);
        if (sortBy === "graduated" && !!a.graduated !== !!b.graduated) return a.graduated ? -1 : 1;
        return endedTs(b) - endedTs(a);
      });
  }, [sortBy]);

  // The category list depends on the chosen grouping. Each is {key,title,icon,
  // tagline,rounds}; empty groups are dropped at render.
  const groups = useMemo(() => {
    if (groupBy === "modifier") {
      const over = visible.filter((r) => r.modifiers?.overtime);
      const none = visible.filter((r) => !r.modifiers?.overtime);
      return [
        {
          key: "overtime",
          title: "Over Time",
          icon: "⏱️",
          tagline: "Earned bonus minutes for staying hot",
          rounds: sortRounds(over),
        },
        {
          key: "none",
          title: "No modifier",
          icon: "🪙",
          tagline: "Standard match rules",
          rounds: sortRounds(none),
        },
      ];
    }
    const byMode = GAME_MODES.map((m) => ({
      key: m.key,
      title: m.name,
      icon: MODE_ICON[m.key],
      tagline: m.tagline,
      rounds: sortRounds(visible.filter((r) => r.mode === m.key)),
    }));
    const unlabeled = sortRounds(visible.filter((r) => !r.mode));
    return [
      ...byMode,
      {
        key: "unlabeled",
        title: "Unlabeled",
        icon: "🪙",
        tagline: "Legacy launches",
        rounds: unlabeled,
      },
    ];
  }, [groupBy, visible, sortRounds]);

  const nonEmpty = groups.filter((g) => g.rounds.length > 0);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-2xl font-black">The Cook Out</h1>
        <p className="mb-5 text-sm text-zinc-400">
          Live now, up next, and every past result. Each match is a real token launched through a
          fair batch auction: one clearing price, pro-rata fills, auditable settlement.
        </p>

        {hero ? (
          <>
            <FeaturedHero round={hero} />
            {queue.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-sm font-black uppercase tracking-wide text-zinc-300">
                    Up Next
                  </h2>
                  <span className="text-xs text-zinc-600">{queue.length} in the queue</span>
                </div>
                <div className="no-scrollbar flex gap-4 overflow-x-auto py-2">
                  {queue.map((r) => (
                    <div key={r.id} className="w-80 shrink-0">
                      <RoundCard round={r} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-2xl bg-lime-400/[0.06] p-8 text-center">
            <div className="text-3xl">🍳</div>
            <p className="mt-2 text-lg font-black text-zinc-100">
              The grill is empty. Someone needs to launch a coin.
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
              Every match starts with the community: launch a coin, the crowd votes it through, and
              it lands right here at the Cook Out at your chosen tier.
            </p>
            <Link
              href="/submissions"
              className="mt-4 inline-block rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300"
            >
              🔥 Launch a Coin →
            </Link>
          </div>
        )}
      </section>

      {finished.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <h2 className="text-lg font-bold text-zinc-300">Past Results</h2>

            {/* result filter (cross-cutting) */}
            <div className="flex flex-wrap gap-1 text-xs font-bold">
              {(
                [
                  ["all", "All"],
                  ["graduated", "🍽️ Served up"],
                  ["failed", "Didn't graduate"],
                  ["burnt", "🔥 Burnt"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3 py-1 transition ${
                    filter === key
                      ? "bg-lime-400 text-zinc-950"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  }`}
                >
                  {label}
                  <span className={filter === key ? "ml-1.5 text-zinc-800" : "ml-1.5 text-zinc-600"}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>

            {/* group-by + sort controls */}
            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
              <Segmented
                label="Group by"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  ["mode", "Mode"],
                  ["modifier", "Modifier"],
                ]}
              />
              <Segmented
                label="Sort"
                value={sortBy}
                onChange={setSortBy}
                options={[
                  ["newest", "Newest"],
                  ["graduated", "Graduated"],
                  ["mcap", "Market cap"],
                ]}
              />
            </div>
          </div>

          {nonEmpty.length === 0 ? (
            <div className="rounded-2xl bg-zinc-900/40 p-6 text-sm text-zinc-500">
              No rounds in this filter yet.
            </div>
          ) : (
            <div className="space-y-6">
              {nonEmpty.map((g) => (
                <CategoryShelf
                  key={g.key}
                  title={g.title}
                  icon={g.icon}
                  tagline={g.tagline}
                  count={g.rounds.length}
                  tally={<ResultTally rounds={g.rounds} />}
                >
                  {g.rounds.map((r) => (
                    <div key={r.id} className="w-80 shrink-0">
                      <ResultCard round={r} />
                    </div>
                  ))}
                </CategoryShelf>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** A small labelled segmented control for the group-by / sort toggles. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-zinc-600">{label}</span>
      <span className="flex overflow-hidden rounded-full bg-zinc-900/70 font-bold">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`px-2.5 py-1 transition ${
              value === v ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {l}
          </button>
        ))}
      </span>
    </span>
  );
}

/** Compact served/burnt/closed summary for a category header. */
function ResultTally({ rounds }: { rounds: Round[] }) {
  const grad = rounds.filter((r) => r.graduated).length;
  const burnt = rounds.filter((r) => !r.graduated && isRug(r)).length;
  const closed = rounds.length - grad - burnt;
  const parts: string[] = [];
  if (grad) parts.push(`🍽️ ${grad}`);
  if (burnt) parts.push(`🔥 ${burnt}`);
  if (closed) parts.push(`${closed} closed`);
  return <>{parts.join(" · ")}</>;
}

/** Compact USD label ($1.2k, $340). */
function compactUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

/** Compact relative time for the results archive. */
function ago(at: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * The showpiece: one big featured round at the top of the page. Live rounds
 * reveal fully; scheduled ones stay teased (blurred art, hidden identity) to
 * preserve the pre-reveal, and show a lobby countdown instead of a market cap.
 */
function FeaturedHero({ round }: { round: Round }) {
  const ethUsd = useEthUsd();
  const teaser = round.state === "scheduled";
  const live = round.state === "live";
  const { token } = round;
  const backdrop = token.bannerUrl || token.artworkUrl;
  const stateLabel: Record<string, string> = {
    scheduled: "Starting soon",
    lobby: "Lobby open",
    queue_open: "Queue open, get in",
    settling: "Settling auction",
    live: "LIVE",
  };
  const mcapUsd = mcapOf(round) * ethUsd;

  // Flash + sound the moment the featured coin advances a phase (scheduled →
  // lobby → queue → settling → live). We only react to the SAME round changing
  // state, not the hero swapping to a different coin.
  const prevPhase = useRef<{ id: string; state: string } | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const p = prevPhase.current;
    prevPhase.current = { id: round.id, state: round.state };
    if (!p || p.id !== round.id || p.state === round.state) return;
    setFlash(true);
    audio.play(round.state === "live" ? "round.launch" : "ui.tab");
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [round.id, round.state]);

  return (
    <Link
      href={`/round/${round.id}`}
      className="group relative block overflow-hidden rounded-3xl bg-zinc-950 shadow-2xl shadow-black/50 transition duration-300 hover:shadow-lime-400/10"
    >
      {flash && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 animate-[phaseflash_0.9s_ease-out] bg-lime-400/40"
        />
      )}
      {backdrop ? (
        <div
          aria-hidden
          className={`absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105 ${
            teaser ? "scale-110 blur-2xl saturate-0" : ""
          }`}
          style={{ backgroundImage: `url(${backdrop})` }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-lime-400/15 to-zinc-950" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-zinc-950/30"
      />

      <div className="relative flex min-h-[240px] flex-col justify-end p-6 md:min-h-[300px] md:p-8">
        <div className="mb-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest ${
              live ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800/80 text-zinc-300"
            }`}
          >
            {live && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
            )}
            {live ? "Now Cooking" : stateLabel[round.state] ?? round.state}
          </span>
        </div>

        <div className="flex items-end gap-4">
          {token.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={token.artworkUrl}
              alt={teaser ? "" : token.name}
              className={`h-16 w-16 shrink-0 rounded-2xl border-2 border-zinc-950 bg-zinc-800 object-cover shadow-lg md:h-20 md:w-20 ${
                teaser ? "blur-md saturate-0" : ""
              }`}
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-zinc-950 bg-zinc-800 text-3xl shadow-lg md:h-20 md:w-20">
              {teaser ? "❓" : "🪙"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-2xl font-black text-zinc-50 drop-shadow md:text-4xl">
                {teaser ? "???" : token.name}
              </h2>
              {!teaser && <span className="font-mono text-sm text-zinc-400">${token.symbol}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {round.mode ? <ModeChip mode={round.mode} /> : <TierChip tier={round.tier} />}
              {round.modifiers?.overtime && <OverTimeChip />}
              <span className="truncate text-xs text-zinc-400">
                {teaser ? `Theme: ${token.theme}` : token.theme}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-300">
            {live ? (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <span className="text-zinc-500">Market cap </span>
                  <span className="font-mono font-black text-lime-300">{compactUsd(mcapUsd)}</span>
                </span>
                {round.endsAt && (
                  <span>
                    <span className="text-zinc-500">Time left </span>
                    <span className="font-mono font-black text-emerald-300">
                      <Countdown to={round.endsAt} />
                    </span>
                  </span>
                )}
              </span>
            ) : round.state === "scheduled" ? (
              <span>
                Lobby opens in <Countdown to={round.scheduledAt} />
              </span>
            ) : round.state === "lobby" && round.queueOpensAt ? (
              <span>
                Queue opens in <Countdown to={round.queueOpensAt} />
              </span>
            ) : round.state === "queue_open" && round.queueClosesAt ? (
              <span>
                Queue closes in <Countdown to={round.queueClosesAt} />
              </span>
            ) : (
              <span className="text-emerald-400">Settling…</span>
            )}
          </div>
          <span className="rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition group-hover:bg-lime-300 group-hover:shadow-lime-300/40">
            {live ? "Trade Live →" : "Pull Up →"}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** A single finished-round card that links through to its results. */
function ResultCard({ round: r }: { round: Round }) {
  const rug = isRug(r);
  const glow = r.graduated
    ? "hover:shadow-[0_16px_44px_-16px_rgba(163,230,53,0.4)]"
    : rug
      ? "hover:shadow-[0_16px_44px_-16px_rgba(239,68,68,0.35)]"
      : "hover:shadow-[0_16px_44px_-16px_rgba(0,0,0,0.7)]";
  return (
    <Link
      href={`/round/${r.id}`}
      className={`group block h-full transition duration-300 hover:-translate-y-1 ${glow}`}
    >
      <CoinCard
        coin={{
          ...r.token,
          tier: r.tier,
          matchMinutes: Math.round(r.config.maxDurationSeconds / 60),
          id: r.conceptId,
          creatorAddress: r.creatorAddress,
          graduated: r.graduated,
          mode: r.mode,
          modifiers: r.modifiers,
        }}
        borderClass="border-transparent"
        corner={
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${
              r.graduated
                ? "bg-lime-400/20 text-lime-300"
                : rug
                  ? "bg-red-500/20 text-red-300"
                  : "bg-zinc-800/90 text-zinc-400"
            }`}
          >
            {r.graduated ? "🍽️ served up" : rug ? "🔥 burnt" : "closed"}
          </span>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-500">
            {r.graduated ? "still trading in the wild" : `ended: ${r.endReason?.replace(/_/g, " ")}`}
            {r.endedAt && <span className="ml-1 text-zinc-700">· {ago(r.endedAt)}</span>}
          </div>
          {!r.graduated && <RunItBackButton round={r} />}
        </div>
      </CoinCard>
    </Link>
  );
}

function RoundCard({ round }: { round: Round }) {
  const teaser = round.state === "scheduled";
  const stateLabel: Record<string, string> = {
    scheduled: "Starting soon",
    lobby: "Lobby open",
    queue_open: "Queue open, get in",
    settling: "Settling auction",
    live: "LIVE",
  };
  return (
    <CoinCard
      coin={{
        ...round.token,
        tier: round.tier,
        matchMinutes: Math.round(round.config.maxDurationSeconds / 60),
        id: round.conceptId,
        creatorAddress: round.creatorAddress,
        graduated: round.graduated,
        mode: round.mode,
        modifiers: round.modifiers,
      }}
      teaser={teaser}
      borderClass="border-transparent"
      corner={
        <span
          className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${
            round.state === "live"
              ? "animate-pulse bg-emerald-500/25 text-emerald-300"
              : "bg-zinc-800/90 text-zinc-300"
          }`}
        >
          {stateLabel[round.state] ?? round.state}
        </span>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-400">
          {round.state === "scheduled" && (
            <>
              Lobby opens in <Countdown to={round.scheduledAt} />
            </>
          )}
          {round.state === "lobby" && round.queueOpensAt && (
            <>
              Queue opens in <Countdown to={round.queueOpensAt} />
            </>
          )}
          {round.state === "queue_open" && round.queueClosesAt && (
            <>
              Queue closes in <Countdown to={round.queueClosesAt} />
            </>
          )}
          {round.state === "live" && <span className="text-emerald-400">Trading now</span>}
        </div>
        <Link
          href={`/round/${round.id}`}
          className="rounded-lg bg-lime-400 px-4 py-2 font-black text-zinc-950 shadow-lg shadow-lime-400/20 transition hover:bg-lime-300 hover:shadow-lime-300/40"
        >
          Pull Up
        </Link>
      </div>
    </CoinCard>
  );
}
