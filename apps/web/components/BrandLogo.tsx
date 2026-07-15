"use client";

import Link from "next/link";
import { useState } from "react";

/** Nav brand: banner image from /brand/banner.png with a styled wordmark
 *  fallback that matches the logo (lime THE + outlined COOKOUT). */
export function BrandLogo() {
  const [imgOk, setImgOk] = useState(true);
  return (
    <Link href="/" className="flex items-center">
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/banner.png"
          alt="THE COOKOUT"
          className="h-8 w-auto"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className="text-lg font-black tracking-tight">
          <span className="text-lime-400">THE</span>{" "}
          <span className="text-zinc-100 [text-shadow:0_0_6px_rgba(163,230,53,0.6)]">COOKOUT</span>
        </span>
      )}
    </Link>
  );
}
