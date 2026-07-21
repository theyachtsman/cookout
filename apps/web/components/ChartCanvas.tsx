"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "@cookout/shared";
import { autoTf, TIMEFRAMES, type TfMode } from "../lib/timeframe";

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
  /** Show the 1s/15s/1m/5m/Auto timeframe zoom (product chart; demo leaves it off). */
  showTimeframes?: boolean;
  /** Round phase + start, so Auto can pick the timeframe that fits the moment. */
  phase?: string;
  liveAt?: number;
  /** Pool depth, shown in the crosshair readout. */
  liquidity?: number;
  /** Draw the tagged bubble over big trades. The live round uses edge callouts
   *  instead so nothing ever sits on the candles; the landing demo keeps them. */
  bubbleLabels?: boolean;
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
  // View-only timeframe zoom: candles aggregate into tf-second buckets.
  // "auto" follows the round — see autoTf().
  const [tfMode, setTfMode] = useState<TfMode>("auto");
  // Auto re-evaluates on a slow tick; nothing else needs the re-render.
  const [, autoTick] = useState(0);
  useEffect(() => {
    if (tfMode !== "auto") return;
    const t = setInterval(() => autoTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [tfMode]);
  const tf = tfMode === "auto" ? autoTf(props.phase, props.liveAt) : tfMode;
  const ref = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tfRef = useRef<number>(tf);
  tfRef.current = tf;

  /** Pointer position for the crosshair; null when it's off the canvas. */
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  /** When each candle bucket was first drawn, so new ones can animate in. */
  const seenRef = useRef(new Map<number, number>());
  /** Last price move, for the flash on the live tag. */
  const tickRef = useRef({ price: 0, dir: 0, at: 0 });

  const clockRef = useRef({ serverT: 0, localMs: 0 });
  const scaleRef = useRef({ lo: 0, hi: 0 });
  const priceRef = useRef(0);
  const liveCandleRef = useRef({ sinceT: 0, hi: 0, lo: Infinity });
  const profileCache = useRef(new Map<string, ProfileTag>());

  // Blast-off: when the opening candle lands while we're watching (the chart
  // had no candles the frame before), it animates growing upward instead of
  // popping in fully formed.
  const blastRef = useRef<{ armed: boolean; t: number; startMs: number }>({
    armed: false,
    t: 0,
    startMs: 0,
  });

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
      const { candles, trades, livePrice, openPrice, supply, bigTradeEth, cooking, endReason, graduated, windowSec, highlightAddress, ethUsd, liquidity, bubbleLabels } =
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
        blastRef.current.armed = true; // we're watching pre-open — animate it
        ctx.fillStyle = "#52525b";
        ctx.font = "13px ui-monospace, monospace";
        ctx.fillText("waiting for the open…", 16, h / 2);
        return;
      }
      const blast = blastRef.current;
      if (blast.armed && blast.t !== candles[0]!.t) {
        blast.t = candles[0]!.t;
        blast.startMs = Date.now();
      }

      const f = modeRef.current === "mcap" && supply ? supply : 1;
      void f;
      const money = (v: number) =>
        v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
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
      // Candles ease in over ~260ms the first time we see them: the body grows
      // out of the open and the wick extends with it. Bigger moves carry a
      // little more momentum, so a violent candle reads as violent.
      const seen = seenRef.current;
      if (seen.size > 400) seen.clear();
      const appear = (c: Candle): number => {
        let at = seen.get(c.t);
        if (at === undefined) {
          at = Date.now();
          seen.set(c.t, at);
        }
        const body = Math.abs(c.c - c.o) / Math.max(1e-12, s.hi - s.lo);
        const ms = 260 + Math.min(180, body * 900);
        const e = (Date.now() - at) / ms;
        return e >= 1 ? 1 : 1 - Math.pow(1 - e, 3);
      };
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
      // Blast-off: the opening candle grows upward over ~1.1s (ease-out) with
      // a live glow, instead of appearing fully formed. The y-scale already
      // fits its final height, so it launches into pre-cleared airspace.
      const blastMs = blast.startMs ? Date.now() - blast.startMs : Infinity;
      const blastP = blast.armed && blastMs < 600 ? 1 - Math.pow(1 - blastMs / 600, 3) : 1;
      const isBlast = (c: Candle) => c.t <= blast.t && blast.t < c.t + tfSec;
      const grow = (c: Candle): Candle => {
        // The opening candle owns the blast-off; everything else eases in.
        if (blastP < 1 && isBlast(c)) return blastGrow(c);
        const a = appear(c);
        if (a >= 1) return c;
        return {
          ...c,
          c: c.o + (c.c - c.o) * a,
          h: c.o + (c.h - c.o) * a,
          l: c.o + (c.l - c.o) * a,
        };
      };
      const blastGrow = (c: Candle): Candle =>
        blastP >= 1
          ? c
          : {
              ...c,
              c: c.o + (c.c - c.o) * blastP,
              h: c.o + (c.h - c.o) * blastP,
              l: Math.min(c.o, c.l),
            };

      for (const c of visible) drawCandle(grow(c), blastP < 1 && isBlast(c));
      if (liveCandle) drawCandle(grow(liveCandle), true);

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
        if (bubbleLabels !== false && big && age < TOOLTIP_MS) {
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
      // The tag reacts to every real price change: a quick swell and a brighter
      // fill in the direction of the move, settling within ~450ms so it reads
      // as a heartbeat rather than a strobe.
      const tk = tickRef.current;
      if (tk.price === 0) tk.price = targetPrice;
      else if (Math.abs(targetPrice - tk.price) > tk.price * 1e-9) {
        tk.dir = targetPrice > tk.price ? 1 : -1;
        tk.at = Date.now();
        tk.price = targetPrice;
      }
      const tickAge = Date.now() - tk.at;
      const pulse = tk.at && tickAge < 450 ? 1 - tickAge / 450 : 0;
      const flashColor = tk.dir > 0 ? "#4ade80" : "#f87171";
      const pw = ctx.measureText(priceLabel).width + 10 + pulse * 4;
      const ph = 18 + pulse * 4;
      ctx.save();
      if (pulse > 0) {
        ctx.shadowColor = flashColor;
        ctx.shadowBlur = 14 * pulse;
      }
      ctx.fillStyle = pulse > 0.35 ? flashColor : pillColor;
      ctx.beginPath();
      ctx.roundRect(w - pw - 2, ly - ph / 2, pw, ph, 4);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#09090b";
      ctx.fillText(priceLabel, w - pw + 3 + pulse * 2, ly + 4);

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

      // ---- crosshair: TradingView-style readout for the hovered candle ----
      const mp = mouseRef.current;
      if (mp && !dragRef.current && mp.x < plotW) {
        const all = liveCandle ? [...visible, liveCandle] : visible;
        // Snap to the candle under the cursor rather than the raw pixel.
        let hit: Candle | null = null;
        for (const c of all) {
          const cx = x(c.t);
          if (mp.x >= cx && mp.x < cx + cw) { hit = c; break; }
        }
        if (!hit && all.length) hit = all[all.length - 1]!;

        ctx.save();
        ctx.strokeStyle = "#52525b";
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mp.y);
        ctx.lineTo(w, mp.y);
        const snapX = hit ? x(hit.t) + cw / 2 : mp.x;
        ctx.moveTo(snapX, 0);
        ctx.lineTo(snapX, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // price tag on the axis at the cursor
        const hoverP = s.lo + (1 - mp.y / h) * (s.hi - s.lo);
        ctx.font = "bold 10px ui-monospace, monospace";
        const hLabel = supply && ethUsd ? money(hoverP * supply * ethUsd) : fmt(hoverP);
        const hw = ctx.measureText(hLabel).width + 8;
        ctx.fillStyle = "#3f3f46";
        ctx.beginPath();
        ctx.roundRect(w - hw - 2, mp.y - 8, hw, 16, 3);
        ctx.fill();
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(hLabel, w - hw + 2, mp.y + 4);

        if (hit) {
          const up = hit.c >= hit.o;
          const chg = hit.o ? ((hit.c - hit.o) / hit.o) * 100 : 0;
          const rows: Array<[string, string, string?]> = [
            ["Time", new Date(hit.t * 1000).toLocaleTimeString([], { hour12: false })],
            ["Market Cap", supply && ethUsd ? money(hit.c * supply * ethUsd) : fmt(hit.c)],
            ["Price", hit.c.toExponential(3)],
            ["O", fmt(hit.o)],
            ["H", fmt(hit.h)],
            ["L", fmt(hit.l)],
            ["C", fmt(hit.c), up ? UP : DOWN],
            ["Change", `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, up ? UP : DOWN],
            ["Volume", `${hit.v.toFixed(3)}`],
          ];
          if (liquidity !== undefined) rows.push(["Liquidity", liquidity.toFixed(2)]);

          ctx.font = "10px ui-monospace, monospace";
          let boxW = 0;
          for (const [k, v] of rows) boxW = Math.max(boxW, ctx.measureText(`${k}  ${v}`).width);
          boxW += 24;
          const boxH = rows.length * 13 + 10;
          // Flip to whichever side of the cursor has room.
          const bx = mp.x + 14 + boxW > plotW ? Math.max(4, mp.x - boxW - 14) : mp.x + 14;
          const by = Math.min(Math.max(4, mp.y - boxH / 2), h - boxH - 4);
          ctx.fillStyle = "rgba(9,9,11,0.92)";
          ctx.strokeStyle = "#3f3f46";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx, by, boxW, boxH, 6);
          ctx.fill();
          ctx.stroke();
          rows.forEach(([k, v, tone], i) => {
            const ry = by + 16 + i * 13;
            ctx.fillStyle = "#71717a";
            ctx.fillText(k, bx + 7, ry);
            ctx.fillStyle = tone ?? "#e4e4e7";
            ctx.textAlign = "right";
            ctx.fillText(v, bx + boxW - 7, ry);
            ctx.textAlign = "left";
          });
        }
        ctx.restore();
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
    const onHover = (e: PointerEvent) => {
      const rect = canvas!.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => (mouseRef.current = null);
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
    canvas?.addEventListener("pointermove", onHover);
    canvas?.addEventListener("pointerleave", onLeave);
    canvas?.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      canvas?.removeEventListener("pointerdown", onDown);
      canvas?.removeEventListener("pointermove", onMove);
      canvas?.removeEventListener("pointerup", onUp);
      canvas?.removeEventListener("pointercancel", onUp);
      canvas?.removeEventListener("pointermove", onHover);
      canvas?.removeEventListener("pointerleave", onLeave);
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
          style={tf > 1 ? { cursor: "crosshair", touchAction: "none" } : { cursor: "crosshair" }}
      />
      {props.showTimeframes && (
        <div className="absolute right-2 top-2 flex overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/80 text-[10px] font-bold backdrop-blur">
          {TIMEFRAMES.map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setTfMode(v);
                resetView();
              }}
              className={`px-2 py-1 ${
                tfMode === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              setTfMode("auto");
              resetView();
            }}
            title="Follows the round: 1s at the open, zooming out as it runs"
            className={`px-2 py-1 ${
              tfMode === "auto" ? "bg-lime-400 text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tfMode === "auto" ? `Auto ${TIMEFRAMES.find(([v]) => v === tf)?.[1] ?? ""}` : "Auto"}
          </button>
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
