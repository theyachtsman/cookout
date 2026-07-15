"use client";

import { useEffect, useRef } from "react";
import type { Candle, Trade } from "@cookout/shared";

/**
 * Live round chart — smooth scrolling price line built from real 1-second
 * candles (never simulated), with a glowing area fill, pulsing live-price
 * dot, animated autoscale, and trade tooltips pinned to the exact moment
 * and price each player bought or sold.
 */

interface Props {
  candles: Candle[];
  trades: Trade[];
  livePrice?: number;
  openPrice?: number; // auction clearing price
  cooking?: boolean;
  endReason?: string;
  graduated?: boolean;
}

const WINDOW_SEC = 90;
const TOOLTIP_MS = 4000;

export function Chart(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // Anchor the moving right edge to the latest candle's server time.
  const clockRef = useRef({ serverT: 0, localMs: 0 });
  const scaleRef = useRef({ lo: 0, hi: 0 });
  const priceRef = useRef(0);

  const last = props.candles[props.candles.length - 1];
  if (last && last.t > clockRef.current.serverT) {
    clockRef.current = { serverT: last.t, localMs: Date.now() };
  }

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { candles, trades, livePrice, openPrice, cooking, endReason, graduated } =
        propsRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (candles.length === 0) {
        ctx.fillStyle = "#52525b";
        ctx.font = "13px ui-monospace, monospace";
        ctx.fillText("waiting for the open…", 16, h / 2);
        return;
      }

      // --- time domain ---
      // Live: scrolling window anchored on server candle time.
      // Ended: full-round snapshot fitted to the canvas.
      const snapshot = !!endReason;
      const { serverT, localMs } = clockRef.current;
      let nowT: number;
      let t0: number;
      let span: number;
      if (snapshot) {
        t0 = candles[0]!.t;
        nowT = candles[candles.length - 1]!.t;
        span = Math.max(10, nowT - t0);
      } else {
        nowT = serverT + Math.min(2, (Date.now() - localMs) / 1000);
        span = WINDOW_SEC;
        t0 = nowT - span;
      }
      const x = (t: number) => ((t - t0) / span) * (w - 74); // reserve right gutter

      // --- price series in window ---
      const visible = snapshot ? candles : candles.filter((c) => c.t >= t0 - 2);
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of visible) {
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
      }
      if (openPrice) {
        lo = Math.min(lo, openPrice);
        hi = Math.max(hi, openPrice);
      }
      if (!isFinite(lo)) return;
      if (hi === lo) {
        hi *= 1.0005;
        lo *= 0.9995;
      }
      const pad = (hi - lo) * 0.15;
      // animated autoscale: ease displayed bounds toward targets
      const s = scaleRef.current;
      if (snapshot || (s.lo === 0 && s.hi === 0)) {
        s.lo = lo - pad;
        s.hi = hi + pad;
      } else {
        s.lo += (lo - pad - s.lo) * 0.08;
        s.hi += (hi + pad - s.hi) * 0.08;
      }
      const y = (p: number) => h - ((p - s.lo) / (s.hi - s.lo)) * h;

      // eased live price for a smooth dot between 1s updates
      const targetPrice = snapshot
        ? visible[visible.length - 1]!.c
        : (livePrice ?? visible[visible.length - 1]!.c);
      if (priceRef.current === 0 || snapshot) priceRef.current = targetPrice;
      else priceRef.current += (targetPrice - priceRef.current) * 0.15;
      const dispPrice = priceRef.current;

      const up = !openPrice || dispPrice >= openPrice;
      const lineColor = cooking ? "#fb923c" : up ? "#34d399" : "#f87171";

      // --- grid ---
      ctx.strokeStyle = "#1f1f23";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const gy = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // --- open (clearing) price reference line ---
      if (openPrice) {
        ctx.strokeStyle = "#71717a";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y(openPrice));
        ctx.lineTo(w, y(openPrice));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#71717a";
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText("open", 6, y(openPrice) - 4);
      }

      // --- price path (candle closes + eased live point) ---
      const pts: Array<[number, number]> = [];
      for (const c of visible) pts.push([x(c.t), y(c.c)]);
      pts.push([x(nowT), y(dispPrice)]);

      // area fill
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, lineColor + "3d");
      grad.addColorStop(1, lineColor + "00");
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], h);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.lineTo(pts[pts.length - 1]![0], h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // glowing line (midpoint-smoothed)
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
        const my = (pts[i]![1] + pts[i + 1]![1]) / 2;
        ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // --- trade markers + tooltips ---
      const nowMs = Date.now();
      for (const t of trades) {
        const tx = x(t.at / 1000);
        if (tx < 0) continue;
        const ty = y(t.price);
        const buy = t.side === "buy";
        const color = buy ? "#34d399" : "#f87171";
        ctx.beginPath();
        ctx.arc(tx, ty, t.isCreator ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#09090b";
        ctx.lineWidth = 1;
        ctx.stroke();

        const age = nowMs - (t as Trade & { seenAt?: number }).seenAt!;
        if (age >= 0 && age < TOOLTIP_MS) {
          const alpha = age < TOOLTIP_MS - 600 ? 1 : (TOOLTIP_MS - age) / 600;
          const who = t.isCreator
            ? "Developer"
            : `${t.userAddress.slice(0, 6)}…${t.userAddress.slice(-2)}`;
          const label = `${who} ${buy ? "bought" : "sold"} ${t.ethAmount.toFixed(2)}`;
          ctx.font = "11px ui-monospace, monospace";
          const tw = ctx.measureText(label).width + 12;
          const bx = Math.min(Math.max(4, tx - tw / 2), w - tw - 4);
          const above = ty > 34;
          const by = above ? ty - 30 : ty + 12;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#18181b";
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.roundRect(bx, by, tw, 18, 5);
          ctx.fill();
          ctx.stroke();
          // pointer nub
          ctx.beginPath();
          ctx.moveTo(tx, above ? ty - 7 : ty + 7);
          ctx.lineTo(tx - 4, above ? by + 18 : by);
          ctx.lineTo(tx + 4, above ? by + 18 : by);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.fillStyle = "#e4e4e7";
          ctx.fillText(label, bx + 6, by + 13);
          ctx.globalAlpha = 1;
        }
      }

      // --- live price dot + right-edge price pill ---
      const lx = x(nowT);
      const ly = y(dispPrice);
      if (!snapshot) {
        const pulse = 3 + Math.sin(nowMs / 220) * 1.4;
        ctx.beginPath();
        ctx.arc(lx, ly, pulse + 4, 0, Math.PI * 2);
        ctx.fillStyle = lineColor + "2e";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
      }

      ctx.font = "bold 11px ui-monospace, monospace";
      const priceLabel = dispPrice.toExponential(3);
      const pw = ctx.measureText(priceLabel).width + 10;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.roundRect(w - pw - 2, ly - 9, pw, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#09090b";
      ctx.fillText(priceLabel, w - pw + 3, ly + 4);

      // % since open chip
      if (openPrice) {
        const pct = ((dispPrice - openPrice) / openPrice) * 100;
        ctx.font = "bold 13px ui-monospace, monospace";
        ctx.fillStyle = lineColor;
        ctx.fillText(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% since open`, 8, 18);
      }
      if (cooking) {
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = "#fb923c";
        ctx.fillText("🔥 cooking", 8, 34);
      }

      // --- end-of-round overlays ---
      if (endReason) {
        const rug = endReason === "rug_detected" || endReason === "liquidity_removed";
        ctx.fillStyle = rug ? "rgba(127,29,29,0.35)" : "rgba(9,9,11,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = "center";
        ctx.font = "bold 34px ui-sans-serif, system-ui";
        if (graduated) {
          ctx.fillStyle = "#34d399";
          ctx.fillText("🎓 GRADUATED", w / 2, h / 2 - 6);
        } else if (rug) {
          ctx.fillStyle = "#f87171";
          ctx.fillText("🔥 BURNT", w / 2, h / 2 - 6);
        } else {
          ctx.fillStyle = "#e4e4e7";
          ctx.fillText("ROUND OVER", w / 2, h / 2 - 6);
        }
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillStyle = "#a1a1aa";
        ctx.fillText(endReason.replace(/_/g, " "), w / 2, h / 2 + 18);
        ctx.textAlign = "left";
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-950"
    />
  );
}
