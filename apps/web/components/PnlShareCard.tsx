"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The shareable P&L card: the branded mascot artwork (left) with the trade's
 * numbers rendered into the black panel on the right. Generated fully
 * client-side on a canvas — Copy puts a PNG on the clipboard for pasting
 * straight into X; Download saves it.
 *
 * Artwork: /brand/pnl-card.png (1477×1080). If the file is missing the card
 * falls back to a clean dark layout so sharing never breaks.
 */

export interface PnlCardData {
  symbol: string;
  artworkUrl?: string;
  pct: number;
  pnlUsd: number;
  valueUsd: number;
  costUsd: number;
  name?: string;
}

const W = 1477;
const H = 1080;
/** Center-line of the black text panel in the artwork. */
const CX = W * 0.768;

export function PnlShareCard({
  data,
  onClose,
}: {
  data: PnlCardData;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = (bg: HTMLImageElement | null, art: HTMLImageElement | null) => {
      ctx.clearRect(0, 0, W, H);
      if (bg) {
        ctx.drawImage(bg, 0, 0, W, H);
      } else {
        // Fallback: still a clean branded card without the artwork.
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "#a3e635";
        ctx.lineWidth = 10;
        ctx.strokeRect(20, 20, W - 40, H - 40);
        ctx.font = "200px serif";
        ctx.textAlign = "center";
        ctx.fillText("🔥", W * 0.25, H * 0.55);
        ctx.font = "bold 70px ui-sans-serif, system-ui";
        ctx.fillStyle = "#a3e635";
        ctx.fillText("THE COOKOUT", W * 0.25, H * 0.75);
      }

      const up = data.pnlUsd >= 0;
      const tone = up ? "#34d399" : "#f87171";
      const fmt = (v: number) =>
        `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(2) + "k" : Math.abs(v).toFixed(2)}`;

      ctx.textAlign = "center";

      // Token: coin image beside the ticker, the pair centered as a group.
      ctx.font = "bold 58px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#e4e4e7";
      const tickerText = `$${data.symbol}`;
      const tw = ctx.measureText(tickerText).width;
      if (art) {
        const size = 84;
        const gap = 20;
        const startX = CX - (size + gap + tw) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(startX + size / 2, 378, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(art, startX, 378 - size / 2, size, size);
        ctx.restore();
        ctx.strokeStyle = "#a3e635";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(startX + size / 2, 378, size / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.textAlign = "left";
        ctx.fillText(tickerText, startX + size + gap, 398);
        ctx.textAlign = "center";
      } else {
        ctx.fillText(tickerText, CX, 400);
      }

      // The big number — auto-fit to the panel so it never runs off the card.
      const pctText = `${up ? "+" : ""}${data.pct.toFixed(2)}%`;
      let pctSize = 150;
      const maxPctW = 520;
      do {
        ctx.font = `900 ${pctSize}px ui-sans-serif, system-ui`;
        if (ctx.measureText(pctText).width <= maxPctW) break;
        pctSize -= 6;
      } while (pctSize > 60);
      ctx.fillStyle = tone;
      ctx.shadowColor = tone;
      ctx.shadowBlur = 40;
      ctx.fillText(pctText, CX, 560);
      ctx.shadowBlur = 0;

      // Label + dollar P&L
      ctx.font = "bold 30px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#71717a";
      ctx.fillText("U N R E A L I Z E D   P & L", CX, 625);
      ctx.font = "900 74px ui-monospace, Menlo, monospace";
      ctx.fillStyle = tone;
      ctx.fillText(`${up ? "+" : ""}${fmt(data.pnlUsd)}`, CX, 710);

      // Value / cost line
      ctx.font = "34px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText(`bag ${fmt(data.valueUsd)}  ·  cost ${fmt(data.costUsd)}`, CX, 775);

      // Player
      if (data.name) {
        ctx.font = "bold 38px ui-sans-serif, system-ui";
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(data.name, CX, 845);
      }

      // Site
      ctx.font = "900 44px ui-sans-serif, system-ui";
      ctx.fillStyle = "#a3e635";
      ctx.fillText("thecookout.fun", CX, data.name ? 915 : 870);
      ctx.textAlign = "left";
    };

    let bg: HTMLImageElement | null = null;
    let art: HTMLImageElement | null = null;
    let loaded = 0;
    const total = data.artworkUrl ? 2 : 1;
    const done = () => {
      loaded += 1;
      if (loaded >= total) render(bg, art);
    };
    const img = new Image();
    img.onload = () => {
      bg = img;
      done();
    };
    img.onerror = done;
    img.src = "/brand/pnl-card.png";
    if (data.artworkUrl) {
      const a = new Image();
      // Coin art is usually a data: URL (canvas-safe); external URLs need
      // CORS or they'd taint the canvas and break Copy/Download.
      if (!data.artworkUrl.startsWith("data:")) a.crossOrigin = "anonymous";
      a.onload = () => {
        art = a;
        done();
      };
      a.onerror = done;
      a.src = data.artworkUrl;
    }
  }, [data]);

  const toBlob = () =>
    new Promise<Blob>((resolve, reject) =>
      canvasRef.current?.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png"),
    );

  const copy = async () => {
    setFailed("");
    try {
      const blob = await toBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed("clipboard blocked — use Download instead");
    }
  };

  const download = async () => {
    const blob = await toBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cookout-${data.symbol}-pnl.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <canvas ref={canvasRef} width={W} height={H} className="w-full rounded-xl" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void copy()}
            className="rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
          >
            {copied ? "✓ Copied — paste it on X" : "Copy image"}
          </button>
          <button
            onClick={() => void download()}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-200 hover:border-zinc-500"
          >
            Download PNG
          </button>
          <button onClick={onClose} className="ml-auto px-3 py-2 text-sm text-zinc-500 hover:text-zinc-200">
            Close
          </button>
        </div>
        {failed && <div className="mt-2 text-sm text-red-400">{failed}</div>}
      </div>
    </div>
  );
}
