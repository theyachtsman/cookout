"use client";

import { useState } from "react";

/**
 * A streaming-style "rail" — a titled category that stays collapsed to a
 * horizontal, scrollbar-less row of cards and expands into a full grid on
 * demand. Borderless and boxless so the page reads like a media storefront,
 * not a table of results.
 *
 * Presentational only: the parent supplies both the `preview` (the cards for
 * the collapsed rail) and `children` (the full responsive grid). We swap
 * between them on the header toggle.
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
  /** Cards for the collapsed horizontal rail. */
  preview: React.ReactNode;
  /** Full grid shown while expanded. */
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 py-2 text-left"
      >
        {icon != null && <span className="text-xl leading-none">{icon}</span>}
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-lg font-black text-zinc-100">{title}</span>
            <span className="font-mono text-xs text-zinc-500">{count}</span>
          </span>
          {tagline && <span className="block text-[11px] text-zinc-500">{tagline}</span>}
        </span>
        {tally && (
          <span className="ml-auto hidden text-[11px] text-zinc-500 md:block">{tally}</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs font-black text-zinc-500 transition group-hover:text-lime-400 md:ml-3">
          {open ? "Show less" : `See all ${count}`}
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="grid gap-4 pt-1 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      ) : (
        <div className="relative">
          <div className="no-scrollbar flex gap-4 overflow-x-auto py-2">{preview}</div>
          {/* soft right-edge fade hints there's more to scroll */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-zinc-950 to-transparent"
          />
        </div>
      )}
    </section>
  );
}
