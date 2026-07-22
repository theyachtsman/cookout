"use client";

import Link from "next/link";
import { useBrandAsset } from "../lib/useBrandAsset";

/** Nav brand: real banner from /brand/banner.png when present, bundled SVG
 *  wordmark otherwise — never a broken-image glyph. Fills the nav bar's height
 *  (minus a hair of inset) so it anchors the bar instead of floating small. */
export function BrandLogo() {
  const src = useBrandAsset("/brand/banner.png", "/brand/banner.svg");
  return (
    <Link href="/" className="flex h-full shrink-0 items-center py-1">
      {/* Shorter on mobile so the wide wordmark fits beside the hamburger and
          wallet; fills the bar height on desktop where there's room. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="THE COOKOUT" className="h-9 w-auto sm:h-full" />
    </Link>
  );
}
