"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Slim staging marker so you always know you're on the dev site, not live.
 * Shows only on a `dev.` host (or localhost, or NEXT_PUBLIC_DEV_ENV=1) — it
 * renders nothing on production www/apex, so it's inert there.
 */
export function DevBanner() {
  // Build-time flag paints immediately with no flash; the host check below is
  // the zero-config path that just works on dev.thecookout.fun.
  const [show, setShow] = useState(process.env.NEXT_PUBLIC_DEV_ENV === "1");

  useEffect(() => {
    const h = window.location.hostname.toLowerCase();
    if (h.startsWith("dev.") || h === "localhost" || h === "127.0.0.1") setShow(true);
  }, []);

  if (!show) return null;

  let apiHost = "";
  try {
    apiHost = API ? new URL(API).host : "";
  } catch {
    /* leave blank if the URL is malformed */
  }

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-center text-[11px] font-black uppercase tracking-wider text-zinc-950">
      <span>🚧 Dev environment · staging, not live</span>
      {apiHost && (
        <span className="hidden font-mono normal-case tracking-normal text-amber-900 sm:inline">
          · {apiHost}
        </span>
      )}
    </div>
  );
}
