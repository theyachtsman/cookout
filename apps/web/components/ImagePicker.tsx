"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side image picker with a built-in crop/zoom editor.
 *
 * Pick a file → an editor opens where you drag to reposition and zoom to fit
 * the exact shape (circle for avatars, box for art, wide strip for banners) →
 * confirm, and it's rendered to a compact webp data URL that stays well under
 * the API body limit. No external storage needed in the paper MVP.
 */
export function ImagePicker({
  label,
  value,
  onChange,
  size = 512,
  round = false,
  wide = false,
  aspect,
}: {
  label: string;
  value?: string;
  onChange: (dataUrl: string) => void;
  /** Output width in px (height derives from the aspect ratio). */
  size?: number;
  round?: boolean;
  /** Wide (~3:1) preview + crop for banner uploads. */
  wide?: boolean;
  /** Output width ÷ height. Defaults: 1 (square/round) or 3 (wide). */
  aspect?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [editSrc, setEditSrc] = useState<string | null>(null);
  const ratio = aspect ?? (wide ? 3 : 1);

  const pick = (file: File) => {
    setError("");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setError("png, jpg, webp, or gif only");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("image too large (max 12MB)");
      return;
    }
    setEditSrc(URL.createObjectURL(file));
  };

  const closeEditor = () => {
    if (editSrc) URL.revokeObjectURL(editSrc);
    setEditSrc(null);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex items-center justify-center overflow-hidden border border-dashed border-zinc-600 bg-zinc-900 text-2xl hover:border-zinc-400 ${
          round ? "rounded-full" : "rounded-lg"
        } ${wide ? "h-14 w-44" : "h-16 w-16"}`}
        title={label}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-full w-full object-cover" />
        ) : (
          "+"
        )}
      </button>
      <div className="text-xs text-zinc-500">
        <div>{label}</div>
        {error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-zinc-400 hover:text-zinc-200"
          >
            {value ? "change · reposition" : "click to upload"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />
      {editSrc && (
        <ImageEditor
          src={editSrc}
          aspect={ratio}
          round={round}
          outputWidth={size}
          onCancel={closeEditor}
          onDone={(dataUrl) => {
            onChange(dataUrl);
            closeEditor();
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

/**
 * The crop stage: the image is drawn into a fixed viewport, scaled to "cover"
 * as a floor, and the player drags to pan / slides to zoom. On confirm, the
 * exact region under the viewport is rendered to an output canvas at full
 * resolution — what you frame is what you get.
 */
function ImageEditor({
  src,
  aspect,
  round,
  outputWidth,
  onCancel,
  onDone,
}: {
  src: string;
  aspect: number;
  round: boolean;
  outputWidth: number;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  // Viewport in CSS px — width bounded to the screen, height from the aspect.
  const vw =
    typeof window !== "undefined" ? Math.min(320, window.innerWidth - 72) : 320;
  const vh = Math.round(vw / aspect);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Base "cover" scale, then the zoom multiplier on top.
  const cover = nat ? Math.max(vw / nat.w, vh / nat.h) : 1;
  const eff = cover * zoom;
  const dispW = nat ? nat.w * eff : vw;
  const dispH = nat ? nat.h * eff : vh;

  const clamp = useCallback(
    (p: { x: number; y: number }) => ({
      x: Math.min(0, Math.max(vw - dispW, p.x)),
      y: Math.min(0, Math.max(vh - dispH, p.y)),
    }),
    [vw, vh, dispW, dispH],
  );

  // Load the source, capture natural size, and center it.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = Math.max(vw / img.width, vh / img.height);
      setNat({ w: img.width, h: img.height });
      setPos({ x: (vw - img.width * c) / 2, y: (vh - img.height * c) / 2 });
    };
    img.src = src;
  }, [src, vw, vh]);

  // Re-clamp whenever the framing changes (e.g. after a zoom).
  useEffect(() => {
    if (nat) setPos((p) => clamp(p));
  }, [zoom, nat, clamp]);

  const onZoom = (z: number) => {
    // Keep the viewport center anchored while zooming.
    const prevEff = cover * zoom;
    const nextEff = cover * z;
    const cx = (vw / 2 - pos.x) / prevEff;
    const cy = (vh / 2 - pos.y) / prevEff;
    setZoom(z);
    setPos(clamp({ x: vw / 2 - cx * nextEff, y: vh / 2 - cy * nextEff }));
  };

  const confirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const outW = outputWidth;
    const outH = Math.round(outputWidth / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    // The source rectangle currently framed by the viewport.
    const sx = -pos.x / eff;
    const sy = -pos.y / eff;
    const sW = vw / eff;
    const sH = vh / eff;
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
    onDone(canvas.toDataURL("image/webp", 0.85));
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-black text-zinc-100">
          Position your image
          <span className="ml-2 font-normal text-zinc-500">drag to move · slide to zoom</span>
        </div>

        {/* crop stage */}
        <div className="flex justify-center">
          <div
            className="relative touch-none overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700"
            style={{ width: vw, height: vh, cursor: drag.current ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setPos(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => {
              const next = Math.min(5, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
              onZoom(next);
            }}
          >
            {nat && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{ width: dispW, height: dispH, left: pos.x, top: pos.y }}
              />
            )}
            {/* shape guide — a circular mask cue for round crops */}
            {round && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ boxShadow: "inset 0 0 0 9999px rgba(9,9,11,0.55)", borderRadius: "9999px" }}
              />
            )}
          </div>
        </div>

        {/* zoom */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-zinc-500">Zoom</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-lime-400"
          />
        </div>

        {/* actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-bold text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-lg bg-lime-400 px-5 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Use image
          </button>
        </div>
      </div>
    </div>
  );
}
