"use client";

import Link from "next/link";
import { useBrandAsset } from "../lib/useBrandAsset";

/** Nav brand: real banner from /brand/banner.png when present, bundled SVG
 *  wordmark otherwise — never a broken-image glyph. */
export function BrandLogo() {
  const src = useBrandAsset("/brand/banner.png", "/brand/banner.svg");
  return (
    <Link href="/" className="flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="THE COOKOUT" className="h-9 w-auto" />
    </Link>
  );
}
