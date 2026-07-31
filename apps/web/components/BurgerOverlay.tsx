"use client";

import { useEffect, useState } from "react";
import { onBurger, type BurgerGain } from "../lib/burgerBus";
import { audio } from "../lib/audio";

interface Toast extends BurgerGain {
  id: number;
}

/**
 * The 🍔 Burger reward drop-in: whenever Burgers land (the server pushes a
 * "burger" socket event to just this player), an animated toast slides in with
 * a chime. Multiple rewards queue and stack; they never interrupt gameplay.
 * Mounted once in the root layout, alongside the +XP overlay.
 */
export function BurgerOverlay() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let seq = 0;
    return onBurger((e) => {
      if (e.amount <= 0) return; // only celebrate credits
      const t: Toast = { ...e, id: ++seq };
      setToasts((prev) => [...prev.slice(-3), t]);
      audio.play("burger.earn");
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 2600);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[95] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-burgerslide flex items-center gap-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-zinc-950/90 px-4 py-2.5 shadow-2xl ring-1 ring-amber-400/40 backdrop-blur"
        >
          <span className="text-2xl">🍔</span>
          <div className="leading-tight">
            <div className="font-mono text-lg font-black tabular-nums text-amber-300">
              +{t.amount.toLocaleString()} $BURG
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-500/80">{t.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
