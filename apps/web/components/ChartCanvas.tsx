"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "@cookout/shared";

/**
 * The arena chart renderer — the exact live-round candlestick chart, extracted
 * so both the real product (Chart.tsx, which resolves trader profiles from the
 * API) and the landing-page demo (ArenaDemo, which feeds simulated data) render
 * pixel-identical output. Animated 1-second candles: the current candle wicks
 * and grows in real time, the window scrolls, the scale eases, and big
 * buys/sells pop a tagged bubble at the exact time+price they hit.
 */

interface ProfileTag {
  name: string;
  img?: HTMLImageElement;
}

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
  /** Scrolling window width in buckets-of-timeframe (default 75). */
  windowSec?: number;
  /** ETH/USD peg: when set (with supply), the live tag shows $ market cap. */
  ethUsd?: number;
  /** Show the 1s/1m/10m timeframe zoom (product chart; demo leaves it off). */
  showTimeframes?: boolean;
  /** Stretch to fill the parent (the landing demo's flex slot). The product
   *  page must NOT set this: a percentage height inside a grid-stretched
   *  column balloons to the whole column and shoves the panels below it. */
  fill?: boolean;
  /** Trades from this address always get a tagged bubble (e.g. your own). */
  highlightAddress?: string;
  /** Populate a trader tag (name/avatar) for a bubble — async mutation ok. */
  resolveTag?: (address: string, tag: ProfileTag) => void;
  /** Canvas classes (size/border). Defaults to the product's 20rem panel. */
  className?: string;
}

const WINDOW_SEC = 75;
const TOOLTIP_MS = 4500;
const UP = "#22c55e";
const DOWN = "#ef4444";

export function ChartCanvas(props: Props) {
  // Market-cap view only — the MCAP/PRICE switch was cut (it sat on top of
  // the candles); price still shows in the tooltip/labels scale.
  const mode = "mcap" as const;
  // View-only timeframe zoom: candles aggregate into 1s/1m/10m buckets.
  const [tf, setTf] = useState<1 | 60 | 600>(1);
  const ref = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tfRef = useRef<number>(tf);
  tfRef.current = tf;

  const clockRef = useRef({ serverT: 0, localMs: 0 });
  const scaleRef = useRef({ lo: 0, hi: 0 });
  const priceRef = useRef(0);
  const liveCandleRef = useRef({ sinceT: 0, hi: 0, lo: Infinity });
  const profileCache = useRef(new Map<string, ProfileTag>());

  // Pan/zoom (1m/10m views only — 1s stays a locked live feed). While a
  // manual view is active the window stops following the clock; Reset (or
  // switching timeframe) snaps back to auto-follow.
  const viewRef = useRef({ active: false, t0: 0, span: 0 });
  const autoRef = useRef({ t0: 0, span: 0, nowT: 0, firstT: 0, plotW: 1 });
  const dragRef = useRef<{ x: number; t0: number } | null>(null);
  const [panned, setPanned] = useState(false);

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
      propsRef.current.resolveTag?.(address, tag);
    }
    return tag;
  };

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { candles, trades, livePrice, openPrice, supply, bigTradeEth, cooking, endReason, graduated, windowSec, highlightAddress, ethUsd } =
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

      const f = modeRef.current === "mcap" && supply ? supply : 1;
      void f;
      const fmt = (p: number) =>
        modeRef.current === "mcap" && supply
          ? (p * supply >= 100 ? (p * supply).toFixed(1) : (p * supply).toFixed(2))
          : p.toExponential(3);

      const snapshot = !!endReason;
      // View-only timeframe zoom: aggregate 1s candles into tf-second buckets.
      const tfSec = tfRef.current;
      let agg = candles;
      if (tfSec > 1) {
        const buckets = new Map<number, Candle>();
        for (const c of candles) {
          const bt = Math.floor(c.t / tfSec) * tfSec;
          const b = buckets.get(bt);
          if (!b) buckets.set(bt, { t: bt, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
          else {
            b.h = Math.max(b.h, c.h);
            b.l = Math.min(b.l, c.l);
            b.c = c.c;
            b.v += c.v;
          }
        }
        agg = [...buckets.values()];
      }

      const { serverT, localMs } = clockRef.current;
      let nowT: number;
      let t0: number;
      let span: number;
      if (snapshot) {
        t0 = agg[0]!.t;
        nowT = agg[agg.length - 1]!.t + tfSec;
        span = Math.max(10 * tfSec, nowT - t0);
      } else {
        nowT = serverT + Math.min(2, (Date.now() - localMs) / 1000) + tfSec;
        const defaultSpan = (windowSec ?? WINDOW_SEC) * tfSec;
        if (tfSec === 1) {
          // The 1s view is the locked live feed: fixed scrolling window.
          span = defaultSpan;
        } else {
          // Zoomed views fit the data like a real chart: candles fill the
          // width until there's more history than the standard window holds
          // — never a mostly-empty screen with a sliver at the right edge.
          const dataSpan = nowT - agg[0]!.t + tfSec;
          span = Math.min(defaultSpan, Math.max(4 * tfSec, dataSpan));
        }
        t0 = nowT - span;
        const v = viewRef.current;
        if (v.active && tfSec > 1) {
          // Manual pan/zoom window, clamped so you can't fly off the data.
          span = Math.min(Math.max(v.span, 5 * tfSec), span * 4);
          const firstT = agg[0]!.t;
          t0 = Math.min(Math.max(v.t0, firstT - span * 0.5), nowT - span * 0.2);
          v.span = span;
          v.t0 = t0;
        }
      }
      const plotW = w - 80;
      autoRef.current = { t0, span, nowT, firstT: agg[0]!.t, plotW };
      const x = (t: number) => ((t - t0) / span) * plotW;
      const cw = (plotW / span) * tfSec;

      const visible = snapshot ? agg : agg.filter((c) => c.t >= t0 - 2 * tfSec);
      if (visible.length === 0) return;
      const lastClosed = candles[candles.length - 1]!;

      const targetPrice = snapshot ? lastClosed.c : (livePrice ?? lastClosed.c);
      if (priceRef.current === 0 || snapshot) priceRef.current = targetPrice;
      else priceRef.current += (targetPrice - priceRef.current) * 0.18;
      const disp = priceRef.current;
      const lc = liveCandleRef.current;
      lc.hi = Math.max(lc.hi, disp);
      lc.lo = Math.min(lc.lo, disp);
      let liveCandle: Candle | null = null;
      if (!snapshot) {
        const liveT = lastClosed.t + 1;
        if (tfSec === 1) {
          liveCandle = { t: liveT, o: lastClosed.c, h: lc.hi, l: lc.lo, c: disp, v: 0 };
        } else {
          // Merge the in-progress second into its bucket so the last candle
          // keeps wicking live at any zoom.
          const bt = Math.floor(liveT / tfSec) * tfSec;
          const lastB = visible[visible.length - 1];
          if (lastB && lastB.t === bt) {
            visible.pop();
            liveCandle = {
              t: bt,
              o: lastB.o,
              h: Math.max(lastB.h, lc.hi),
              l: Math.min(lastB.l, lc.lo),
              c: disp,
              v: lastB.v,
            };
          } else {
            liveCandle = { t: bt, o: lastClosed.c, h: lc.hi, l: lc.lo, c: disp, v: 0 };
          }
        }
      }

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
        ctx.beginPath();
        ctx.moveTo(cx, y(c.h));
        ctx.lineTo(cx, y(c.l));
        ctx.stroke();
        const top = y(Math.max(c.o, c.c));
        const bh = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
        ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
        ctx.shadowBlur = 0;
      };
      for (const c of visible) drawCandle(c, false);
      if (liveCandle) drawCandle(liveCandle, true);

      const nowMs = Date.now();
      const threshold = bigTradeEth ?? Infinity;
      for (const t of trades) {
        const tx = x(t.at / 1000);
        if (tx < 0 || tx > plotW) continue;
        const ty = y(t.price);
        const buy = t.side === "buy";
        const color = buy ? UP : DOWN;
        const mine = !!highlightAddress && t.userAddress === highlightAddress;
        const big = t.ethAmount >= threshold || t.isCreator || mine;
        ctx.beginPath();
        ctx.arc(tx, ty, mine ? 4.5 : big ? 4 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (mine) {
          // Your own entries/exits pin to the chart permanently — a lime-ringed
          // bubble only this viewer sees (the ring keys off their own address).
          ctx.strokeStyle = "#a3e635";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else {
          ctx.strokeStyle = "#09090b";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

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

      const ly = y(disp);
      const lastUp = liveCandle ? liveCandle.c >= liveCandle.o : lastClosed.c >= lastClosed.o;
      const pillColor = lastUp ? UP : DOWN;
      ctx.font = "bold 11px ui-monospace, monospace";
      // The live tag reads as market cap — $ when the USD peg is known.
      const mcap = supply ? disp * supply : disp;
      const usd = ethUsd ? mcap * ethUsd : 0;
      const priceLabel = usd
        ? usd >= 1_000_000
          ? `$${(usd / 1_000_000).toFixed(2)}M`
          : usd >= 1000
            ? `$${(usd / 1000).toFixed(1)}k`
            : `$${usd.toFixed(0)}`
        : fmt(disp);
      const pw = ctx.measureText(priceLabel).width + 10;
      ctx.fillStyle = pillColor;
      ctx.beginPath();
      ctx.roundRect(w - pw - 2, ly - 9, pw, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#09090b";
      ctx.fillText(priceLabel, w - pw + 3, ly + 4);

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

    // ---- pan/zoom interactions (canvas-scoped, 1m/10m only) ----
    const canvas = ref.current;
    const canPan = () => tfRef.current > 1 && !propsRef.current.endReason;
    const activate = () => {
      const v = viewRef.current;
      if (!v.active) {
        v.active = true;
        v.t0 = autoRef.current.t0;
        v.span = autoRef.current.span;
        setPanned(true);
      }
      return v;
    };
    const onDown = (e: PointerEvent) => {
      if (!canPan()) return;
      const v = activate();
      dragRef.current = { x: e.clientX, t0: v.t0 };
      canvas?.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !canPan()) return;
      const v = viewRef.current;
      const { span, plotW } = autoRef.current;
      v.t0 = d.t0 - ((e.clientX - d.x) / plotW) * span;
    };
    const onUp = () => (dragRef.current = null);
    const onWheel = (e: WheelEvent) => {
      if (!canPan()) return;
      e.preventDefault();
      const v = activate();
      const { plotW } = autoRef.current;
      const rect = canvas!.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / plotW));
      const tCursor = v.t0 + frac * v.span;
      const factor = Math.pow(1.0015, e.deltaY);
      v.span = v.span * factor;
      v.t0 = tCursor - frac * v.span;
    };
    canvas?.addEventListener("pointerdown", onDown);
    canvas?.addEventListener("pointermove", onMove);
    canvas?.addEventListener("pointerup", onUp);
    canvas?.addEventListener("pointercancel", onUp);
    canvas?.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      canvas?.removeEventListener("pointerdown", onDown);
      canvas?.removeEventListener("pointermove", onMove);
      canvas?.removeEventListener("pointerup", onUp);
      canvas?.removeEventListener("pointercancel", onUp);
      canvas?.removeEventListener("wheel", onWheel);
    };
  }, []);

  const resetView = () => {
    viewRef.current.active = false;
    dragRef.current = null;
    setPanned(false);
  };

  return (
    <div className={props.fill ? "relative h-full" : "relative"}>
      <canvas
        ref={ref}
        className={props.className ?? "h-80 w-full rounded-xl border border-zinc-800 bg-zinc-950"}
        style={tf > 1 ? { cursor: "grab", touchAction: "none" } : undefined}
      />
      {props.showTimeframes && (
        <div className="absolute right-2 top-2 flex overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/80 text-[10px] font-bold backdrop-blur">
          {([
            [1, "1s"],
            [60, "1m"],
            [600, "10m"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setTf(v);
                resetView();
              }}
              className={`px-2 py-1 ${
                tf === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {panned && (
        <button
          onClick={resetView}
          className="absolute bottom-2 right-2 rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-[11px] font-bold text-zinc-300 backdrop-blur hover:border-zinc-500 hover:text-zinc-100"
        >
          ⟲ Reset view
        </button>
      )}
    </div>
  );
}
