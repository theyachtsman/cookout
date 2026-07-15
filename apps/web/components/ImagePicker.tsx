"use client";

import { useRef, useState } from "react";

/**
 * Client-side image picker: reads a file, downscales it on a canvas, and
 * returns a compact data URL (stays well under the API body limit — no
 * external storage needed in the paper MVP).
 */
export function ImagePicker({
  label,
  value,
  onChange,
  size = 256,
  round = false,
}: {
  label: string;
  value?: string;
  onChange: (dataUrl: string) => void;
  size?: number;
  round?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const pick = async (file: File) => {
    setError("");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setError("png, jpg, webp, or gif only");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("image too large (max 8MB)");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("could not read image"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onChange(canvas.toDataURL("image/webp", 0.85));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex h-16 w-16 items-center justify-center overflow-hidden border border-dashed border-zinc-600 bg-zinc-900 text-2xl hover:border-zinc-400 ${
          round ? "rounded-full" : "rounded-lg"
        }`}
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
        {error ? <div className="text-red-400">{error}</div> : <div>click to upload</div>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
