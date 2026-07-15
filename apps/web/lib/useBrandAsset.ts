"use client";

import { useEffect, useState } from "react";

/**
 * Brand assets: prefer the real PNG dropped into public/brand/, fall back to
 * the bundled SVG recreation. Probing with an offscreen Image avoids the
 * broken-image glyph entirely (an SSR'd <img> that 404s before hydration
 * never fires onError, so conditional rendering alone isn't safe).
 */
export function useBrandAsset(pngPath: string, svgPath: string): string {
  const [src, setSrc] = useState(svgPath);
  useEffect(() => {
    const probe = new Image();
    probe.onload = () => setSrc(pngPath);
    probe.src = pngPath;
  }, [pngPath]);
  return src;
}
