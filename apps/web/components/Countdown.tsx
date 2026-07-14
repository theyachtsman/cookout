"use client";

import { useEffect, useState } from "react";

export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return (
    <span className="font-mono font-bold text-zinc-100">
      {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}
