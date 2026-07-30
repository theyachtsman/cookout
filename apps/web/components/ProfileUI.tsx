"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AchievementDef, RoundHistoryEntry } from "@cookout/shared";
import { repStanding } from "./Reputation";

/**
 * Shared building blocks for the player / creator profile pages, so the
 * internal profile, the public profile, and the creator page all read as one
 * competitive, esports-grade profile system: a borderless identity banner
 * (with the reputation score built in), consistent stat tiles, underline tabs,
 * and boxless match history. Nothing here draws a card border or a table —
 * separation comes from elevation, spacing, and color.
 */

/* ------------------------------------------------------------------ level */

/** Level medal color, bracketed to the tier-unlock thresholds (10, 35). */
export function levelStyle(level: number): { ring: string; text: string; glow: string } {
  if (level >= 35)
    return { ring: "ring-amber-400/70", text: "text-amber-300", glow: "rgba(251,191,36,0.45)" };
  if (level >= 10)
    return { ring: "ring-violet-400/60", text: "text-violet-300", glow: "rgba(167,139,250,0.4)" };
  return { ring: "ring-lime-400/60", text: "text-lime-300", glow: "rgba(163,230,53,0.4)" };
}

/** The circular level medallion that overlaps the avatar. */
export function LevelMedal({ level, size = 48 }: { level: number; size?: number }) {
  const s = levelStyle(level);
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-full bg-zinc-950 ring-2 ${s.ring}`}
      style={{ width: size, height: size, boxShadow: `0 0 18px ${s.glow}` }}
      title={`Level ${level}`}
    >
      <span className={`font-black leading-none ${s.text}`} style={{ fontSize: size * 0.4 }}>
        {level}
      </span>
      <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-500">lvl</span>
    </div>
  );
}

/** Big display avatar with a level-colored ring; initials fallback. */
export function Avatar({
  url,
  name,
  level,
  size = 112,
}: {
  url?: string;
  name: string;
  level: number;
  size?: number;
}) {
  const s = levelStyle(level);
  const initials = name.replace(/^0x/i, "").slice(0, 2).toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className={`rounded-2xl border-2 border-zinc-950 object-cover shadow-xl ring-2 ${s.ring}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className={`flex items-center justify-center rounded-2xl border-2 border-zinc-950 bg-gradient-to-br from-zinc-800 to-zinc-900 font-black text-zinc-400 shadow-xl ring-2 ${s.ring}`}
      style={{ width: size, height: size, fontSize: size * 0.3 }}
    >
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------------- hero */

/**
 * The identity banner every profile opens with: a wide media header, the
 * avatar with a level medal, name + title + chips, an XP-to-next-level bar, the
 * reputation score built right in, and a right-hand slot for a headline number
 * (balance / PnL). `children` renders extra rows beneath (referral, links).
 */
export function ProfileHero({
  avatar,
  name,
  level,
  title,
  badge,
  xp,
  currLevelXp,
  nextLevelXp,
  chips,
  right,
  rep,
  accent = false,
  bannerUrl,
  children,
}: {
  avatar: ReactNode;
  name: string;
  level: number;
  title: string;
  /** Equipped badge emoji, shown before the name. */
  badge?: string;
  /** Omit the XP trio to hide the level bar (e.g. the creator page). */
  xp?: number;
  currLevelXp?: number;
  nextLevelXp?: number;
  chips?: ReactNode;
  right?: ReactNode;
  /** Creator reputation score — shown as a headline tile on the banner. Omit to hide. */
  rep?: number;
  /** Tint the banner red (banned) instead of the default lime wash. */
  accent?: boolean;
  /** Player-uploaded header image shown behind the avatar + level. */
  bannerUrl?: string;
  children?: ReactNode;
}) {
  const showXp = xp !== undefined && currLevelXp !== undefined && nextLevelXp !== undefined;
  const span = Math.max(1, (nextLevelXp ?? 1) - (currLevelXp ?? 0));
  const pct = Math.max(0, Math.min(100, (((xp ?? 0) - (currLevelXp ?? 0)) / span) * 100));
  const toNext = Math.max(0, (nextLevelXp ?? 0) - (xp ?? 0));
  const s = levelStyle(level);
  const st = rep !== undefined ? repStanding(rep) : null;

  return (
    <div className="overflow-hidden rounded-3xl bg-zinc-900/40">
      {/* banner: an uploaded image if the player set one, otherwise a wash. A
          gradient scrim over any image keeps the avatar + name legible. */}
      <div className="relative h-28 w-full overflow-hidden sm:h-44">
        {bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div
          className={`absolute inset-0 ${
            bannerUrl
              ? "bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent"
              : accent
                ? "bg-gradient-to-br from-red-500/20 via-red-500/5 to-transparent"
                : "bg-gradient-to-br from-lime-400/15 via-emerald-400/5 to-transparent"
          }`}
        />
      </div>

      <div className="px-4 pb-6 sm:px-6">
        {/* On mobile everything stacks (avatar, then the full-width name, then
            the stat) so the name is never squeezed beside the avatar. From sm up
            it's the familiar avatar | name | stat row. */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5">
          {/* avatar + level medal */}
          <div className="relative -mt-14 shrink-0 sm:-mt-16">
            {avatar}
            <div className="absolute -bottom-2 -right-2">
              <LevelMedal level={level} />
            </div>
          </div>

          {/* identity */}
          <div className="mt-3 min-w-0 flex-1 sm:mt-0 sm:pb-1">
            <h1 className="flex flex-wrap items-center gap-x-2 text-2xl font-black text-zinc-50 sm:text-3xl md:text-4xl">
              {badge && <span className="shrink-0">{badge}</span>}
              <span className="min-w-0 break-words">{name}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className={`font-bold ${s.text}`}>{title}</span>
              {chips}
            </div>
          </div>

          {/* headline stat (balance / PnL) */}
          {right && <div className="mt-3 sm:mt-0 sm:pb-1 sm:text-right">{right}</div>}
        </div>

        {/* headline row: XP progress + the reputation score, side by side */}
        {(showXp || st) && (
          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            {showXp ? (
              <div>
                <div className="mb-1 flex items-baseline justify-between text-[11px]">
                  <span className="font-bold uppercase tracking-wide text-zinc-500">
                    Level {level} → {level + 1}
                  </span>
                  <span className="font-mono text-zinc-500">
                    {((xp ?? 0) - (currLevelXp ?? 0)).toLocaleString()} / {span.toLocaleString()} XP
                    <span className="ml-1 text-zinc-600">· {toNext.toLocaleString()} to go</span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-lime-400 to-emerald-400 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ) : (
              <div />
            )}

            {st && (
              <div className="flex items-center gap-3 rounded-2xl bg-zinc-950/50 px-4 py-2.5">
                <div className={`font-mono text-4xl font-black leading-none tabular-nums ${st.accent}`}>
                  {rep}
                </div>
                <div className="leading-tight">
                  <div className={`text-sm font-black ${st.accent}`}>
                    {st.emoji} {st.label}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Reputation
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {children && <div className="mt-4 space-y-3">{children}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- tabs */

/** Underline tab bar — the profile's top-level order (Overview / Progression / Locker). */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      {tabs.map(([key, label]) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-black transition ${
              active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
            {active && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-lime-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- stat cards */

export function StatCard({
  label,
  value,
  icon,
  tone = "text-zinc-100",
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-zinc-900/50 p-4 transition hover:bg-zinc-900/80">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
        {icon && <span className="text-xs">{icon}</span>}
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-black tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/* --------------------------------------------------------------- section */

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">{title}</h2>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------- achievements */

export const RARITY: Record<
  string,
  { label: string; ring: string; text: string; wash: string; medal: string; glow: string }
> = {
  common: {
    label: "Common",
    ring: "border-zinc-700",
    text: "text-zinc-300",
    wash: "bg-zinc-900/50",
    medal: "bg-zinc-800",
    glow: "rgba(161,161,170,0.25)",
  },
  rare: {
    label: "Rare",
    ring: "border-sky-500/50",
    text: "text-sky-300",
    wash: "bg-sky-500/[0.08]",
    medal: "bg-sky-500/25",
    glow: "rgba(56,189,248,0.4)",
  },
  epic: {
    label: "Epic",
    ring: "border-violet-500/50",
    text: "text-violet-300",
    wash: "bg-violet-500/[0.08]",
    medal: "bg-violet-500/25",
    glow: "rgba(167,139,250,0.4)",
  },
  legendary: {
    label: "Legendary",
    ring: "border-amber-400/60",
    text: "text-amber-300",
    wash: "bg-amber-400/[0.08]",
    medal: "bg-amber-400/25",
    glow: "rgba(251,191,36,0.45)",
  },
};

/** One achievement as a badge tile — a rarity-colored medallion, the name, a
 *  rarity chip, and the description. Unlocked medallions glow; locked ones dim
 *  to a padlock. Borderless, on-brand. */
export function AchievementCard({
  achievement: a,
  unlocked,
}: {
  achievement: AchievementDef;
  unlocked: boolean;
}) {
  const r = RARITY[a.rarity] ?? RARITY.common;
  return (
    <div
      className={`flex gap-3 rounded-2xl p-4 transition ${
        unlocked ? r.wash : "bg-zinc-900/30"
      }`}
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${
          unlocked ? r.medal : "bg-zinc-800/60"
        } ${unlocked ? "" : "opacity-60 grayscale"}`}
        style={unlocked ? { boxShadow: `0 0 20px ${r.glow}` } : undefined}
      >
        {unlocked ? "🏅" : "🔒"}
      </div>
      <div className={`min-w-0 flex-1 ${unlocked ? "" : "opacity-55"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-black text-zinc-100">{a.name}</span>
          <span
            className={`shrink-0 rounded-full bg-zinc-950/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
              unlocked ? r.text : "text-zinc-600"
            }`}
          >
            {r.label}
          </span>
        </div>
        <div className="mt-1 text-xs leading-snug text-zinc-400">{a.description}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- expandable list */

/**
 * Shows the first `cap` rows, then a "View all N" toggle that expands the rest
 * inline inside a fixed-height, scrollable box (a real scrollbar) so long lists
 * never run the page off the screen. `render` supplies each row (keyed).
 */
export function ExpandableRows<T>({
  items,
  render,
  cap = 5,
  gap = "space-y-1.5",
  maxHeight = "max-h-[28rem]",
}: {
  items: T[];
  render: (item: T) => ReactNode;
  cap?: number;
  gap?: string;
  maxHeight?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = items.length > cap;
  const shown = expanded || !overflow ? items : items.slice(0, cap);
  return (
    <>
      <div className={expanded ? `${gap} ${maxHeight} overflow-y-auto pr-1` : gap}>
        {shown.map(render)}
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-black text-lime-400 transition hover:text-lime-300"
        >
          {expanded ? "Show less" : `View all ${items.length} →`}
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------ match list */

function MatchRow(h: RoundHistoryEntry) {
  return (
    <Link
      key={h.roundId}
      href={`/round/${h.roundId}`}
      className="flex items-center gap-4 rounded-2xl bg-zinc-900/40 px-4 py-3 transition hover:bg-zinc-900/80"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-zinc-100">
          {h.name} <span className="font-mono text-zinc-500">${h.symbol}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          <span className="uppercase">{h.tier}</span> ·{" "}
          {h.graduated ? (
            <span className="text-lime-300">served up</span>
          ) : (
            <span>{h.endReason.replace(/_/g, " ")}</span>
          )}
        </div>
      </div>
      <div className="hidden text-right text-[10px] uppercase tracking-wide text-zinc-600 sm:block">
        invested
        <div className="font-mono text-sm normal-case tracking-normal text-zinc-300">
          {h.invested.toFixed(2)}
        </div>
      </div>
      <div
        className={`w-24 shrink-0 text-right font-mono text-base font-black ${
          h.pnl >= 0 ? "text-emerald-400" : "text-red-400"
        }`}
      >
        {h.pnl >= 0 ? "+" : ""}
        {h.pnl.toFixed(3)}
      </div>
    </Link>
  );
}

/** Trading history as borderless rows (no table). Shows `cap` newest, then
 *  "View all" expands into a scrollable box. */
export function MatchHistory({ entries, cap = 5 }: { entries: RoundHistoryEntry[]; cap?: number }) {
  if (entries.length === 0)
    return (
      <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        No rounds played yet.
      </div>
    );
  return <ExpandableRows items={entries} render={MatchRow} cap={cap} />;
}
