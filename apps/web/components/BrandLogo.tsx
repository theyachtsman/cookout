"use client";

import Link from "next/link";
import { useBrandAsset } from "../lib/useBrandAsset";

/** Nav brand: real banner from /brand/banner.png when present, bundled SVG
 *  wordmark otherwise — never a broken-image glyph. Sized to anchor the bar as
 *  the loudest thing in it, not float small beside the links. */
export function BrandLogo() {
  const src = useBrandAsset("/brand/banner.png", "/brand/banner.svg");
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="The Cookout — home">
      {/* Big and legible: taller than the old fill-the-bar sizing, a touch
          shorter on mobile so it still clears the hamburger + wallet chip. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="THE COOKOUT"
        className="h-11 w-auto drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)] sm:h-14"
      />
    </Link>
  );
}
