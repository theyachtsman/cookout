"use client";

import { useEffect, useState } from "react";
import { audio } from "../lib/audio";

/**
 * A one-tap toggle for the ambient music bed, kept in the nav so atmosphere is
 * always a click away. Reflects the persisted preference; lights up lime when on.
 */
export function MusicToggle({ className = "" }: { className?: string }) {
  const [on, setOn] = useState(false);
  // The AudioManager is client-only; read the saved preference after mount.
  useEffect(() => setOn(audio.isMusicOn()), []);

  return (
    <button
      onClick={() => setOn(audio.toggleMusic())}
      title={on ? "Ambient music: on" : "Ambient music: off"}
      aria-label="Toggle ambient music"
      aria-pressed={on}
      className={`rounded-lg p-2 text-base leading-none transition ${
        on ? "text-lime-300 hover:bg-lime-400/10" : "text-zinc-500 opacity-70 hover:bg-zinc-800 hover:text-zinc-300"
      } ${className}`}
    >
      🎵
    </button>
  );
}
