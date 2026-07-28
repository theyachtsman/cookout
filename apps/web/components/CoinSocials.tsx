"use client";

import type { CoinSocials } from "@cookout/shared";

/**
 * The coin's socials as interactive badges for the trading banner. The creator
 * enters a raw handle or URL on the launchpad; we normalize each to a full link
 * here so a plain "@handle" still opens the right place. Only the links that
 * were set render, and each opens in a new tab.
 */

type Platform = keyof CoinSocials;

const META: Record<Platform, { icon: string; label: string }> = {
  x: { icon: "𝕏", label: "X" },
  telegram: { icon: "✈️", label: "Telegram" },
  youtube: { icon: "▶️", label: "YouTube" },
  instagram: { icon: "📸", label: "Instagram" },
  website: { icon: "🌐", label: "Website" },
};

const ORDER: Platform[] = ["x", "telegram", "youtube", "instagram", "website"];

/** Turn a raw handle/URL into a full https link for the given platform. */
function hrefFor(platform: Platform, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (platform) {
    case "x":
      return `https://x.com/${handle}`;
    case "telegram":
      return `https://t.me/${handle}`;
    case "youtube":
      // Bare handles get the @-style channel URL; anything path-like passes through.
      return v.includes("/") ? `https://${v}` : `https://youtube.com/@${handle}`;
    case "instagram":
      return `https://instagram.com/${handle}`;
    case "website":
      return `https://${v}`;
  }
}

export function CoinSocials({
  socials,
  className = "",
}: {
  socials?: CoinSocials;
  className?: string;
}) {
  if (!socials) return null;
  const links = ORDER.map((p) => [p, hrefFor(p, socials[p] ?? "")] as const).filter(
    (pair): pair is [Platform, string] => pair[1] !== null,
  );
  if (links.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {links.map(([p, href]) => (
        <a
          key={p}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          title={META[p].label}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-0.5 text-[11px] font-bold text-zinc-300 backdrop-blur transition hover:border-lime-400/60 hover:text-lime-300"
        >
          <span className="text-xs leading-none">{META[p].icon}</span>
          <span className="hidden sm:inline">{META[p].label}</span>
        </a>
      ))}
    </div>
  );
}
