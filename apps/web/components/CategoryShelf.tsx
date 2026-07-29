"use client";

import { useState } from "react";

/**
 * A collapsible storefront "shelf" — a titled category that stays collapsed to
 * a horizontal preview row and expands into a full grid on demand. Used to
 * group the Cook Out archive by game mode / modifier so the page shows an
 * overview, not a wall of every coin ever launched.
 *
 * Presentational only: the parent supplies both the `preview` (a short
 * horizontal-scroll shelf of the first few cards) and `children` (the full
 * responsive grid). We swap between them on the header toggle.
 */
export function CategoryShelf({
  title,
  icon,
  tagline,
  count,
  tally,
  preview,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ReactNode;
  tagline?: string;
  count: number;
  /** Compact result summary shown in the header (e.g. served / burnt tally). */
  tally?: React.ReactNode;
  /** Horizontal-scroll shelf shown while collapsed. */
  preview: React.ReactNode;
  /** Full grid shown while expanded. */
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/20">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-zinc-900/50"
      >
        {icon != null && <span className="text-xl leading-none">{icon}</span>}
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-black text-zinc-100">{title}</span>
            <span className="font-mono text-xs text-zinc-500">{count}</span>
          </span>
          {tagline && <span className="block text-[11px] text-zinc-500">{tagline}</span>}
        </span>
        {tally && <span className="ml-auto hidden text-[11px] text-zinc-400 sm:block">{tally}</span>}
        <svg
          viewBox="0 0 24 24"
          className={`ml-auto h-4 w-4 shrink-0 text-zinc-500 transition-transform sm:ml-3 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className="px-4 pb-4">
        {open ? (
          children
        ) : (
          <>
            {/* streaming-style horizontal preview: scrolls, snaps, hints overflow */}
            <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">{preview}</div>
            {count > 0 && (
              <button
                type="button"
                onClick={toggle}
                className="mt-3 text-xs font-black text-lime-400 transition hover:text-lime-300"
              >
                Show all {count} →
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
