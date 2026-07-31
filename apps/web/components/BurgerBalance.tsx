"use client";

import { useEffect, useRef, useState } from "react";
import { onBurger } from "../lib/burgerBus";

/**
 * The live 🍔 $BURG balance. Seeds from the session profile, then follows the
 * Burger socket feed (balance updates instantly when rewards land). Increases
 * count up smoothly and briefly glow + pulse so every reward feels satisfying.
 */
export function BurgerBalance({
  initial,
  size = "sm",
  className = "",
}: {
  initial: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const [display, setDisplay] = useState(Math.round(initial));
  const [hot, setHot] = useState(false);
  const target = useRef(Math.round(initial));
  const raf = useRef<number | null>(null);

  // Count `display` toward `target.current` over ~0.6s.
  const animateTo = (to: number) => {
    target.current = to;
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = display;
    const delta = to - from;
    if (delta === 0) return;
    const start = performance.now();
    const dur = 600;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + delta * eased));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  // Follow the session-provided value (e.g. after a manual refresh / purchase).
  useEffect(() => {
    animateTo(Math.round(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Live rewards from the socket.
  useEffect(() => {
    return onBurger((e) => {
      animateTo(Math.round(e.balance));
      if (e.amount > 0) {
        setHot(true);
        setTimeout(() => setHot(false), 700);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  useEffect(() => () => void (raf.current && cancelAnimationFrame(raf.current)), []);

  const big = size === "lg";
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-black tabular-nums transition-transform ${
        big ? "text-2xl" : "text-xs"
      } ${hot ? "animate-burgerpop text-amber-300" : "text-amber-200"} ${className}`}
      title="$BURG"
    >
      <span className={big ? "text-2xl" : "text-sm"}>🍔</span>
      {display.toLocaleString()}
      {big && <span className="text-sm font-bold text-amber-500/70">$BURG</span>}
    </span>
  );
}
