"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrandLogo } from "./BrandLogo";
import { JackpotPill } from "./JackpotPill";
import { WalletButton } from "./WalletButton";
import { useChainOnly } from "../lib/chainOnly";
import { useCopy } from "../lib/copy";
import { useSession } from "../lib/session";

/**
 * Top navigation. A short fixed-height bar; on desktop the links sit inline, on
 * mobile they collapse into a hamburger that opens a slide-in drawer. On the
 * public paper site the app links are always browseable (visitors explore
 * logged-out); on the invite-only chain site they appear only once signed in.
 */

interface NavLink {
  href: string;
  label: string;
  /** Requires a signed-in wallet. */
  auth?: boolean;
  accent?: boolean;
}

/** Labels come from editable site copy (nav.* keys), so the nav can be
 *  reworded from the Command Center like everything else. */
// The Cook Out first, because it is what the site is for. Launching a coin
// used to sit here too; it is a two-minute form rather than a destination, so
// it opens as a modal from the Cook Out page instead.
const LINKS: (Omit<NavLink, "label"> & { copyKey: string })[] = [
  { href: "/matches", copyKey: "nav.matches", auth: true },
  { href: "/vote", copyKey: "nav.vote", auth: true },
  { href: "/pit", copyKey: "nav.pit", auth: true },
  { href: "/leaderboard", copyKey: "nav.leaderboard", auth: true },
  { href: "/jackpot", copyKey: "nav.jackpot", auth: true, accent: true },
  { href: "/docs", copyKey: "nav.docs" },
];

export function TopNav() {
  const { t } = useCopy();
  const { profile } = useSession();
  const chainOnly = useChainOnly();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);
  // Close the drawer on navigation.
  useEffect(() => setOpen(false), [pathname]);
  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Public paper site: everything is browseable logged-out, so show every link.
  // Invite-only chain site: hide the app links until there's a session.
  const links = LINKS.filter((l) => !l.auth || profile || !chainOnly);

  return (
    <nav className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-x-3 px-3 sm:gap-x-4 sm:px-5">
        {/* mobile hamburger */}
        <button
          onClick={() => setOpen(true)}
          className="-ml-1 shrink-0 rounded-lg p-2 text-zinc-300 hover:bg-zinc-800 lg:hidden"
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <BrandLogo />
        <span className="hidden rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-300 xl:inline">
          open beta
        </span>

        <div className="flex-1" />

        {/* desktop inline links — only once there's room (lg+); below that the
            hamburger drawer carries them, so nothing wraps or crowds. */}
        <div className="hidden items-center gap-x-4 lg:flex xl:gap-x-5">
          {links.map((l) => {
            const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap text-sm font-semibold transition hover:text-lime-300 ${
                  l.accent
                    ? "text-amber-400/90 hover:text-amber-300"
                    : active
                      ? "text-zinc-100"
                      : "text-zinc-400"
                }`}
              >
                {t(l.copyKey)}
              </Link>
            );
          })}
        </div>

        {/* Jackpot sits with the wallet on the right so the bar reads
            logo · links · [jackpot | account]. */}
        {profile && (
          <div className="hidden sm:block">
            <JackpotPill />
          </div>
        )}
        <WalletButton />
      </div>

      {/* Mobile slide-in drawer — portaled to <body> so it isn't confined by
          the nav's backdrop-filter, which (like transform) makes an ancestor
          the containing block for fixed children. Inside the nav it only
          covered the 56px bar, so the panel's black background stopped there
          and the links overflowed onto the page with nothing behind them. */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[60] lg:hidden ${open ? "" : "pointer-events-none"}`}
            aria-hidden={!open}
          >
            {/* backdrop */}
            <div
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
                open ? "opacity-100" : "opacity-0"
              }`}
            />
            {/* panel */}
            <div
              className={`absolute left-0 top-0 flex h-full w-72 max-w-[82vw] flex-col border-r border-zinc-800 bg-black/90 shadow-2xl backdrop-blur-xl transition-transform duration-200 ${
                open ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <div className="flex h-16 items-center justify-between border-b border-zinc-800 px-4">
                <span className="text-sm font-black text-zinc-200">The Cookout</span>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800"
                  aria-label="Close menu"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-col gap-1 p-3">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`rounded-lg px-3 py-2.5 text-base font-bold hover:bg-zinc-800 ${
                      l.accent ? "text-amber-300" : "text-zinc-200"
                    }`}
                  >
                    {t(l.copyKey)}
                  </Link>
                ))}
              </div>
              {profile && (
                <div className="mt-auto border-t border-zinc-800 p-4">
                  <JackpotPill />
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </nav>
  );
}
