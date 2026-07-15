"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "@cookout/shared";
import { api } from "../lib/api";

/**
 * Live round chart — animated 1-second candlesticks driven by real trades.
 * The current candle wicks and grows in real time between server closes,
 * the window scrolls continuously, and the scale eases as price moves.
 * Big buys/sells pop a tagged bubble (name + avatar) at the exact time and
 * price they hit. Defaults to market-cap view; switchable to price.
 */

interface Props {
  candles: Candle[];
  trades: Trade[];
  livePrice?: number;
  openPrice?: number; // auction clearing price
  supply?: number; // token total supply (for market-cap view)
  bigTradeEth?: number; // bubble threshold
  cooking?: boolean;
  endReason?: string;
  graduated?: boolean;
}

const WINDOW_SEC = 75;
const TOOLTIP_MS = 4500;
const UP = "#22c55e";
const DOWN = "#ef4444";

interface ProfileTag {
  name: string;
  img?: HTMLImageElement;
}

export function Chart(props: Props) {
  const [mode, setMode] = useState<"mcap" | "price">("mcap");
  const ref = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const clockRef = useRef({ serverT: 0, localMs: 0 });
  const scaleRef = useRef({ lo: 0, hi: 0 });
  const priceRef = useRef(0);
  // live candle high/low since the last server close
  const liveCandleRef = useRef({ sinceT: 0, hi: 0, lo: Infinity });
  const profileCache = useRef(new Map<string, ProfileTag>());

  const last = props.candles[props.candles.length - 1];
  if (last && last.t > clockRef.current.serverT) {
    clockRef.current = { serverT: last.t, localMs: Date.now() };
    const lc = liveCandleRef.current;
    if (lc.sinceT !== last.t) {
      liveCandleRef.current = { sinceT: last.t, hi: last.c, lo: last.c };
    }
  }

  const tagFor = (address: string): ProfileTag => {
    const cache = profileCache.current;
    let tag = cache.get(address);
    if (!tag) {
      tag = { name: `${address.slice(0, 6)}…${address.slice(-2)}` };
      cache.set(address, tag);
      api<{ displayName?: string; avatarUrl?: string }>(`/api/profile/${address}`)
        .then((p) => {
          if (p.displayName) tag!.name = p.displayName;
          if (p.avatarUrl) {
            const img = new Image();
            img.onload = () => (tag!.img = img);
            img.src = p.avatarUrl;
          }
        })
        .catch(() => {});
    }
    return tag;
  };

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { candles, trades, livePrice, openPrice, supply, bigTradeEth, cooking, endReason, graduated } =
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

      // market-cap view multiplies every price by supply
      const f = modeRef.current === "mcap" && supply ? supply : 1;
      const fmt = (p: number) =>
        modeRef.current === "mcap" && supply
          ? (p * supply >= 100 ? (p * supply).toFixed(1) : (p * supply).toFixed(2))
          : p.toExponential(3);

      // --- time domain ---
      const snapshot = !!endReason;
      const { serverT, localMs } = clockRef.current;
      let nowT: number;
      let t0: number;
      let span: number;
      if (snapshot) {
        t0 = candles[0]!.t;
        nowT = candles[candles.length - 1]!.t + 1;
        span = Math.max(10, nowT - t0);
      } else {
        nowT = serverT + Math.min(2, (Date.now() - localMs) / 1000) + 1;
        span = WINDOW_SEC;
        t0 = nowT - span;
      }
      const plotW = w - 80; // right gutter for the price pill
      const x = (t: number) => ((t - t0) / span) * plotW;
      const cw = plotW / span; // candle slot width (1s)

      const visible = snapshot ? candles : candles.filter((c) => c.t >= t0 - 2);
      if (visible.length === 0) return;
      const lastClosed = candles[candles.length - 1]!;

      // eased live price → the growing candle
      const targetPrice = snapshot ? lastClosed.c : (livePrice ?? lastClosed.c);
      if (priceRef.current === 0 || snapshot) priceRef.current = targetPrice;
      else priceRef.current += (targetPrice - priceRef.current) * 0.18;
      const disp = priceRef.current;
      const lc = liveCandleRef.current;
      lc.hi = Math.max(lc.hi, disp);
      lc.lo = Math.min(lc.lo, disp);
      const liveCandle: Candle | null = snapshot
        ? null
        : { t: lastClosed.t + 1, o: lastClosed.c, h: lc.hi, l: lc.lo, c: disp, v: 0 };

      // --- scale (eased) ---
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of visible) {
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
      }
      if (liveCandle) {
        lo = Math.min(lo, liveCandle.l);
        hi = Math.max(hi, liveCandle.h);
      }
      if (openPrice && !snapshot) {
        lo = Math.min(lo, openPrice);
        hi = Math.max(hi, openPrice);
      }
      if (hi === lo) {
        hi *= 1.0005;
        lo *= 0.9995;
      }
      const pad = (hi - lo) * 0.18;
      const s = scaleRef.current;
      if (snapshot || (s.lo === 0 && s.hi === 0)) {
        s.lo = lo - pad;
        s.hi = hi + pad;
      } else {
        s.lo += (lo - pad - s.lo) * 0.1;
        s.hi += (hi + pad - s.hi) * 0.1;
      }
      const y = (p: number) => h - ((p - s.lo) / (s.hi - s.lo)) * h;

      // --- grid ---
      ctx.strokeStyle = "#1c1c20";
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const gy = (h / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
        ctx.fillStyle = "#3f3f46";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(fmt(s.hi - ((s.hi - s.lo) * i) / 5), 4, gy - 3);
      }

      // --- open (clearing) reference ---
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
        ctx.fillText(`open ${fmt(openPrice)}`, 6, y(openPrice) - 4);
      }

      // --- candles ---
      const bodyW = Math.max(2, cw * 0.65);
      const drawCandle = (c: Candle, live: boolean) => {
        const cx = x(c.t) + cw / 2;
        if (cx < -cw || cx > plotW + cw) return;
        const up = c.c >= c.o;
        const color = up ? UP : DOWN;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1, cw * 0.12);
        if (live) {
          ctx.shadowColor = cooking ? "#fb923c" : color;
          ctx.shadowBlur = 14;
        }
        // wick
        ctx.beginPath();
        ctx.moveTo(cx, y(c.h));
        ctx.lineTo(cx, y(c.l));
        ctx.stroke();
        // body
        const top = y(Math.max(c.o, c.c));
        const bh = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
        ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
        ctx.shadowBlur = 0;
      };
      for (const c of visible) drawCandle(c, false);
      if (liveCandle) drawCandle(liveCandle, true);

      // --- trade markers + big-trade bubbles ---
      const nowMs = Date.now();
      const threshold = bigTradeEth ?? Infinity;
      for (const t of trades) {
        const tx = x(t.at / 1000) + cw / 2;
        if (tx < 0 || tx > plotW) continue;
        const ty = y(t.price);
        const buy = t.side === "buy";
        const color = buy ? UP : DOWN;
        const big = t.ethAmount >= threshold || t.isCreator;
        ctx.beginPath();
        ctx.arc(tx, ty, big ? 4 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#09090b";
        ctx.lineWidth = 1;
        ctx.stroke();

        const seenAt = (t as Trade & { seenAt?: number }).seenAt;
        const age = seenAt ? nowMs - seenAt : Infinity;
        if (big && age < TOOLTIP_MS) {
          const alpha = age < TOOLTIP_MS - 700 ? 1 : Math.max(0, (TOOLTIP_MS - age) / 700);
          const tag = tagFor(t.userAddress);
          const who = t.isCreator ? "Developer" : tag.name;
          const label = `${who} ${buy ? "bought" : "sold"} ${t.ethAmount.toFixed(2)}`;
          ctx.font = "bold 11px ui-monospace, monospace";
          const hasImg = !!tag.img && !t.isCreator;
          const iconW = hasImg ? 20 : 0;
          const tw = ctx.measureText(label).width + 14 + iconW;
          const bx = Math.min(Math.max(4, tx - tw / 2), w - tw - 4);
          const above = ty > 40;
          const by = above ? ty - 34 : ty + 14;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#18181b";
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(bx, by, tw, 22, 6);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(tx, above ? ty - 8 : ty + 8);
          ctx.lineTo(tx - 4, above ? by + 22 : by);
          ctx.lineTo(tx + 4, above ? by + 22 : by);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          if (hasImg) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(bx + 13, by + 11, 8, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(tag.img!, bx + 5, by + 3, 16, 16);
            ctx.restore();
          }
          ctx.fillStyle = "#e4e4e7";
          ctx.fillText(label, bx + 7 + iconW, by + 15);
          ctx.globalAlpha = 1;
        }
      }

      // --- right-edge price/mcap pill on the live close ---
      const ly = y(disp);
      const lastUp = liveCandle ? liveCandle.c >= liveCandle.o : lastClosed.c >= lastClosed.o;
      const pillColor = lastUp ? UP : DOWN;
      ctx.font = "bold 11px ui-monospace, monospace";
      const priceLabel = fmt(disp);
      const pw = ctx.measureText(priceLabel).width + 10;
      ctx.fillStyle = pillColor;
      ctx.beginPath();
      ctx.roundRect(w - pw - 2, ly - 9, pw, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#09090b";
      ctx.fillText(priceLabel, w - pw + 3, ly + 4);

      // headline: % since open + cooking flag
      if (openPrice) {
        const pct = ((disp - openPrice) / openPrice) * 100;
        ctx.font = "bold 14px ui-monospace, monospace";
        ctx.fillStyle = pct >= 0 ? UP : DOWN;
        ctx.fillText(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, 8, 20);
      }
      if (cooking) {
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = "#fb923c";
        ctx.fillText("🔥 cooking", 8, 36);
      }

      // --- end-of-round overlays ---
      if (endReason) {
        const rug = endReason === "rug_detected" || endReason === "liquidity_removed";
        ctx.fillStyle = rug ? "rgba(127,29,29,0.35)" : "rgba(9,9,11,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = "center";
        ctx.font = "bold 34px ui-sans-serif, system-ui";
        if (graduated) {
          ctx.fillStyle = UP;
          ctx.fillText("🍽️ SERVED UP", w / 2, h / 2 - 6);
        } else if (rug) {
          ctx.fillStyle = DOWN;
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
    <div className="relative">
      <canvas ref={ref} className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-950" />
      <div className="absolute right-2 top-2 flex overflow-hidden rounded-md border border-zinc-700 text-[11px] font-bold">
        <button
          onClick={() => setMode("mcap")}
          className={`px-2 py-1 ${mode === "mcap" ? "bg-lime-400 text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
        >
          MCAP
        </button>
        <button
          onClick={() => setMode("price")}
          className={`px-2 py-1 ${mode === "price" ? "bg-lime-400 text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
        >
          PRICE
        </button>
      </div>
    </div>
  );
}
