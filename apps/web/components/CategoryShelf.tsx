"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A streaming-style "rail" — a titled category whose cards sit in a single
 * horizontal, scrollbar-less row. Borderless and boxless so the page reads
 * like a media storefront. There is no expand: the cards keep their full size
 * and you move along the row with the mouse wheel, a swipe, or the edge arrows
 * (which appear only when there's more than fits on screen).
 */
export function CategoryShelf({
  title,
  icon,
  tagline,
  count,
  tally,
  children,
  hideHeader = false,
}: {
  title: string;
  icon?: React.ReactNode;
  tagline?: string;
  count: number;
  /** Compact result summary shown in the header (e.g. served / burnt tally). */
  tally?: React.ReactNode;
  /** The full row of cards (each a fixed-width, shrink-0 item). */
  children: React.ReactNode;
  /** Omit the category header entirely (ungrouped "None" view). */
  hideHeader?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const hold = useRef<number | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  // Recompute arrow visibility on scroll, on resize, and whenever the card
  // count changes (a new match can land on the 4s calendar refetch).
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    // Turn a vertical wheel into horizontal movement — but only while the rail
    // can still move that way, so page scrolling isn't trapped at the ends.
    const onWheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const right = e.deltaY > 0;
      if ((right && el.scrollLeft >= max - 1) || (!right && el.scrollLeft <= 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(measure, [measure, count]);

  const stop = () => {
    if (hold.current != null) {
      clearInterval(hold.current);
      hold.current = null;
    }
  };
  // Hover (or hold) an arrow to glide that way; a plain click still nudges a
  // little via the first tick, then the pointer-leave stops it.
  const start = (dir: 1 | -1) => {
    stop();
    const el = rail.current;
    if (!el) return;
    hold.current = window.setInterval(() => {
      el.scrollLeft += dir * 11;
    }, 16);
  };
  useEffect(() => stop, []);

  const arrow = (side: "left" | "right") => (
    <button
      type="button"
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      onMouseEnter={() => start(side === "left" ? -1 : 1)}
      onMouseLeave={stop}
      onMouseDown={() => start(side === "left" ? -1 : 1)}
      onMouseUp={stop}
      onClick={() =>
        rail.current?.scrollBy({
          left: (side === "left" ? -1 : 1) * rail.current.clientWidth * 0.8,
          behavior: "smooth",
        })
      }
      className={`absolute top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-900/90 text-zinc-100 shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:bg-lime-400 hover:text-zinc-950 ${
        side === "left" ? "left-1" : "right-1"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={side === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );

  return (
    <section>
      {!hideHeader && (
        <div className="flex items-center gap-3 py-2">
          {icon != null && <span className="text-xl leading-none">{icon}</span>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-lg font-black text-zinc-100">{title}</span>
              <span className="font-mono text-xs text-zinc-500">{count}</span>
            </div>
            {tagline && <div className="text-[11px] text-zinc-500">{tagline}</div>}
          </div>
          {tally && <div className="ml-auto hidden text-[11px] text-zinc-500 md:block">{tally}</div>}
        </div>
      )}

      <div className="group/rail relative">
        {!atStart && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16 bg-gradient-to-r from-zinc-950 to-transparent"
          />
        )}
        {!atEnd && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16 bg-gradient-to-l from-zinc-950 to-transparent"
          />
        )}
        {!atStart && arrow("left")}
        {!atEnd && arrow("right")}
        <div ref={rail} className="no-scrollbar flex gap-4 overflow-x-auto py-2">
          {children}
        </div>
      </div>
    </section>
  );
}
