"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "../lib/audio";

/**
 * The audio control: a speaker button that opens a small mixer — master, UI,
 * and gameplay levels plus a mute toggle. One place, wired straight to the
 * AudioManager, so every sound in the app answers to it.
 */
export function AudioSettings() {
  const [open, setOpen] = useState(false);
  const [mix, setMix] = useState(() => audio.getMix());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const set = (which: "master" | "ui" | "gameplay", v: number) => {
    audio.setVolume(which, v);
    setMix(audio.getMix());
  };

  const sliders: Array<["master" | "ui" | "gameplay", string]> = [
    ["master", "Master"],
    ["gameplay", "Gameplay"],
    ["ui", "Interface"],
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Sound"
        className="text-lg leading-none text-zinc-400 transition hover:text-lime-300"
      >
        {mix.muted ? "🔇" : "🔊"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wide text-zinc-400">Sound</span>
            <button
              onClick={() => {
                audio.toggleMuted();
                setMix(audio.getMix());
              }}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                mix.muted
                  ? "bg-red-500/20 text-red-300"
                  : "bg-lime-400/20 text-lime-300"
              }`}
            >
              {mix.muted ? "Muted" : "On"}
            </button>
          </div>
          <div className={`space-y-3 ${mix.muted ? "pointer-events-none opacity-40" : ""}`}>
            {sliders.map(([key, label]) => (
              <label key={key} className="block">
                <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                  <span>{label}</span>
                  <span className="font-mono">{Math.round(mix[key] * 100)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={mix[key]}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-full accent-lime-400"
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-snug text-zinc-600">
            The arena has its own soundtrack — countdowns, whales, graduations. Tune it to taste.
          </p>
        </div>
      )}
    </div>
  );
}
