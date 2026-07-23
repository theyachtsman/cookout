"use client";

import type { ReactNode } from "react";

/**
 * Shared building blocks for the player / creator profile pages, so the
 * internal profile, the public profile, and the creator page all read as one
 * professional, gaming-grade profile system (think Steam / a studio launcher):
 * a hero identity banner, consistent stat cards, and titled sections.
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
export function LevelMedal({ level, size = 44 }: { level: number; size?: number }) {
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
  size = 96,
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
 * The identity banner every profile opens with: avatar (with a level medal
 * corner), name, title, an XP-to-next-level bar, a chip row, and a right-hand
 * slot for balances or actions. `children` renders extra rows beneath it
 * (name editing, referral, etc.) inside the same card.
 */
export function ProfileHero({
  avatar,
  name,
  level,
  title,
  xp,
  currLevelXp,
  nextLevelXp,
  chips,
  right,
  accent = false,
  children,
}: {
  avatar: ReactNode;
  name: string;
  level: number;
  title: string;
  /** Omit the XP trio to hide the level bar (e.g. the creator page). */
  xp?: number;
  currLevelXp?: number;
  nextLevelXp?: number;
  chips?: ReactNode;
  right?: ReactNode;
  /** Tint the banner red (banned) instead of the default lime wash. */
  accent?: boolean;
  children?: ReactNode;
}) {
  const showXp = xp !== undefined && currLevelXp !== undefined && nextLevelXp !== undefined;
  const span = Math.max(1, (nextLevelXp ?? 1) - (currLevelXp ?? 0));
  const pct = Math.max(0, Math.min(100, (((xp ?? 0) - (currLevelXp ?? 0)) / span) * 100));
  const toNext = Math.max(0, (nextLevelXp ?? 0) - (xp ?? 0));
  const s = levelStyle(level);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
      {/* banner wash */}
      <div
        className={`h-20 w-full ${
          accent
            ? "bg-gradient-to-r from-red-500/20 via-red-500/5 to-transparent"
            : "bg-gradient-to-r from-lime-400/15 via-emerald-400/5 to-transparent"
        }`}
      />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap items-end gap-4">
          {/* avatar + level medal */}
          <div className="relative -mt-12 shrink-0">
            {avatar}
            <div className="absolute -bottom-2 -right-2">
              <LevelMedal level={level} />
            </div>
          </div>

          {/* identity */}
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-2xl font-black text-zinc-50 md:text-3xl">{name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
              <span className={`font-bold ${s.text}`}>{title}</span>
              {chips}
            </div>
          </div>

          {/* right slot */}
          {right && <div className="pb-1 text-right">{right}</div>}
        </div>

        {/* XP bar */}
        {showXp && (
          <div className="mt-4">
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
        )}

        {children && <div className="mt-4 space-y-3">{children}</div>}
      </div>
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 transition hover:border-zinc-700">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
        {icon && <span className="text-xs">{icon}</span>}
        {label}
      </div>
      <div className={`mt-1 font-mono text-xl font-black tabular-nums ${tone}`}>{value}</div>
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
  { label: string; ring: string; text: string; wash: string }
> = {
  common: { label: "Common", ring: "border-zinc-700", text: "text-zinc-300", wash: "bg-zinc-900/40" },
  rare: { label: "Rare", ring: "border-sky-500/50", text: "text-sky-300", wash: "bg-sky-500/[0.06]" },
  epic: {
    label: "Epic",
    ring: "border-violet-500/50",
    text: "text-violet-300",
    wash: "bg-violet-500/[0.06]",
  },
  legendary: {
    label: "Legendary",
    ring: "border-amber-400/60",
    text: "text-amber-300",
    wash: "bg-amber-400/[0.06]",
  },
};
