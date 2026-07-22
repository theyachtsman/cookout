"use client";

import { useEffect, useState } from "react";

/**
 * Brand assets: use the real PNG from public/brand/, and only fall back to the
 * SVG recreation if that PNG is actually missing. We start on the PNG (which is
 * what ships) rather than the SVG, so first paint doesn't 404 on a fallback
 * file that may not exist. An offscreen Image probes for a genuine failure and
 * swaps to the SVG only then.
 */
export function useBrandAsset(pngPath: string, svgPath: string): string {
  const [src, setSrc] = useState(pngPath);
  useEffect(() => {
    setSrc(pngPath);
    const probe = new Image();
    probe.onerror = () => setSrc(svgPath);
    probe.src = pngPath;
  }, [pngPath, svgPath]);
  return src;
}
