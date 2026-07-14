"use client";

import { useEffect, useRef } from "react";
import type { Candle } from "@cookout/shared";

/** Canvas candle chart: 1-second candles, autoscaled, no dependencies. */
export function Chart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const view = candles.slice(-180);
    if (view.length === 0) {
      ctx.fillStyle = "#52525b";
      ctx.font = "13px monospace";
      ctx.fillText("waiting for first trade…", 16, h / 2);
      return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of view) {
      lo = Math.min(lo, c.l);
      hi = Math.max(hi, c.h);
    }
    if (hi === lo) {
      hi *= 1.001;
      lo *= 0.999;
    }
    const pad = (hi - lo) * 0.08;
    hi += pad;
    lo -= pad;
    const y = (p: number) => h - ((p - lo) / (hi - lo)) * h;
    const cw = w / Math.max(view.length, 60);

    // gridlines
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    view.forEach((c, i) => {
      const x = i * cw + cw / 2;
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? "#10b981" : "#ef4444";
      ctx.fillStyle = up ? "#10b981" : "#ef4444";
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      const bodyTop = y(Math.max(c.o, c.c));
      const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)));
      ctx.fillRect(x - Math.max(1, cw * 0.35), bodyTop, Math.max(2, cw * 0.7), bodyH);
    });

    // last price line + label
    const last = view[view.length - 1]!;
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(last.c));
    ctx.lineTo(w, y(last.c));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f59e0b";
    ctx.font = "11px monospace";
    ctx.fillText(last.c.toExponential(3), 8, y(last.c) - 4);
  }, [candles]);

  return <canvas ref={ref} className="h-72 w-full rounded-lg border border-zinc-800 bg-zinc-950" />;
}
