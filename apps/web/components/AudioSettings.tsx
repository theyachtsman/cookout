"use client";

import { useState } from "react";
import { audio } from "../lib/audio";

/**
 * The audio mixer — master, gameplay, and interface levels plus a mute toggle,
 * wired straight to the AudioManager so every sound in the app answers to it.
 * Lives on each user's profile: settings are per-browser, so everyone tunes
 * their own arena soundtrack independently.
 */
export function AudioMixer() {
  const [mix, setMix] = useState(() => audio.getMix());

  const set = (which: "master" | "ui" | "gameplay", v: number) => {
    audio.setVolume(which, v);
    setMix(audio.getMix());
  };

  const sliders: Array<["master" | "ui" | "gameplay", string, string]> = [
    ["master", "Master", "Everything at once"],
    ["gameplay", "Gameplay", "Countdowns, trades, whales, graduations"],
    ["ui", "Interface", "Clicks, chat pings, menus"],
  ];

  return (
    <div className="rounded-xl border border-zinc-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {mix.muted ? "🔇" : "🔊"} Sound
        </h2>
        <button
          onClick={() => {
            audio.toggleMuted();
            setMix(audio.getMix());
          }}
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
            mix.muted ? "bg-red-500/20 text-red-300" : "bg-lime-400/20 text-lime-300"
          }`}
        >
          {mix.muted ? "Muted" : "On"}
        </button>
      </div>
      <div className={`space-y-4 ${mix.muted ? "pointer-events-none opacity-40" : ""}`}>
        {sliders.map(([key, label, hint]) => (
          <label key={key} className="block">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-bold text-zinc-200">{label}</span>
              <span className="font-mono text-xs text-zinc-500">{Math.round(mix[key] * 100)}</span>
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
            <div className="mt-0.5 text-[11px] text-zinc-600">{hint}</div>
          </label>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-snug text-zinc-600">
        Saved on this device. Your mix is yours alone.
      </p>
    </div>
  );
}
