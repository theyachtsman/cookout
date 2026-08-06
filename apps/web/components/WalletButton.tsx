"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_CHAIN_ID, cookoutBalance, onCookoutSigner, signerReady } from "../lib/cookoutWallet";
import { useChainOnly, useCollectionVisible } from "../lib/chainOnly";
import { useSession } from "../lib/session";
import { BurgerBalance } from "./BurgerBalance";
import { RecruitPanel } from "./collection/RecruitPanel";

export function WalletButton() {
  const { profile, signIn, signOut, busy, authError, clearAuthError, promptPlayNow } = useSession();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chainOnly = useChainOnly();
  const collectionVisible = useCollectionVisible();
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);
  // Close the account panel on navigation and lock body scroll while it's open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Chain-only mode: the account panel shows the Cookout Wallet's live on-chain
  // balance instead of paper money.
  const [arenaBal, setArenaBal] = useState<number | null>(null);
  const [signer, setSigner] = useState(signerReady());
  useEffect(() => onCookoutSigner(() => setSigner(signerReady())), []);
  useEffect(() => {
    if (!chainOnly || !profile) return;
    const poll = () => {
      if (signerReady()) cookoutBalance(DEFAULT_CHAIN_ID).then(setArenaBal).catch(() => {});
      else setArenaBal(null);
    };
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [chainOnly, profile, signer]);

  if (profile) {
    const avatarUrl = (profile as unknown as { avatarUrl?: string }).avatarUrl;
    const shortName =
      profile.displayName ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`;
    const Avatar = ({ size }: { size: number }) =>
      avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="rounded-full object-cover ring-1 ring-white/10"
          style={{ height: size, width: size }}
        />
      ) : (
        <span
          className="grid place-items-center rounded-full bg-lime-400/15 text-lime-300"
          style={{ height: size, width: size }}
        >
          <span className="h-2 w-2 rounded-full bg-lime-400" />
        </span>
      );

    return (
      <div ref={ref} className="relative">
        {/* Compact identity chip — balances live in the slide-in panel now, so
            the bar stays clean no matter how many currencies we add. */}
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-zinc-800/70 py-1 pl-1 pr-2.5 text-sm transition hover:bg-zinc-800"
          title="Account"
          aria-label="Open account"
        >
          <Avatar size={26} />
          <span className="hidden max-w-[7rem] truncate font-bold sm:inline">{shortName}</span>
          <span className="text-xs text-zinc-500">▾</span>
        </button>

        {mounted &&
          createPortal(
            <div
              className={`fixed inset-0 z-[70] ${open ? "" : "pointer-events-none"}`}
              aria-hidden={!open}
            >
              {/* backdrop */}
              <div
                onClick={() => setOpen(false)}
                className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
                  open ? "opacity-100" : "opacity-0"
                }`}
              />
              {/* right-side account panel */}
              <div
                className={`absolute right-0 top-0 flex h-full w-80 max-w-[88vw] flex-col border-l border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 ${
                  open ? "translate-x-0" : "translate-x-full"
                }`}
              >
                {/* header: identity */}
                <div className="flex items-center gap-3 border-b border-zinc-800 p-4">
                  <Avatar size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-black text-zinc-100">{shortName}</div>
                    <div className="truncate text-xs text-zinc-500">
                      Lv{profile.level} · {profile.title} · {profile.xp} XP
                    </div>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800"
                    aria-label="Close account"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* balances */}
                <div className="space-y-2 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                    Balances
                  </div>
                  {chainOnly ? (
                    <BalanceRow
                      icon="⚡"
                      label="Cookout Wallet"
                      accent="lime"
                      value={arenaBal !== null ? `${arenaBal.toFixed(4)} ETH` : "—"}
                    />
                  ) : (
                    <>
                      <BalanceRow
                        icon="⚡"
                        label="Cook Out · playable"
                        accent="lime"
                        value={`${(profile.arenaBalance ?? 0).toFixed(2)} pETH`}
                      />
                      <BalanceRow
                        icon="🏦"
                        label="Bank · safe"
                        accent="zinc"
                        value={`${(profile.paperBalance ?? 0).toFixed(2)} pETH`}
                      />
                    </>
                  )}
                  {/* $BURG keeps its live count-up + glow inside the panel. */}
                  <div className="flex items-center justify-between rounded-xl bg-amber-500/[0.07] px-3 py-2.5 ring-1 ring-amber-400/20">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-lg">🍔</span>
                      <span className="font-bold text-amber-200/90">Burgers · $BURG</span>
                    </span>
                    <BurgerBalance initial={profile.burgerBalance ?? 0} />
                  </div>
                </div>

                {/* Recruit NFT Goon — a doorway to /recruit, where crates are
                    bought and opened. Sits by the Burgers that pay for them.
                    Hidden while the collection is unannounced; Burgers stay. */}
                {collectionVisible && <RecruitPanel onNavigate={() => setOpen(false)} />}

                {/* actions */}
                <div className="mt-1 flex flex-col gap-1 px-3">
                  <PanelLink href="/profile" onNavigate={() => setOpen(false)} icon="👤" label="Profile" />
                  <PanelLink
                    href="/wallet"
                    onNavigate={() => setOpen(false)}
                    icon="⚡"
                    label={chainOnly ? "Cookout Wallet" : "Cook Out Balance"}
                  />
                  <PanelLink href="/settings" onNavigate={() => setOpen(false)} icon="⚙️" label="Settings" />
                </div>

                <div className="mt-auto border-t border-zinc-800 p-3">
                  <button
                    onClick={() => {
                      setOpen(false);
                      signOut();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-zinc-400 hover:bg-zinc-800"
                  >
                    <span>⏏</span> Sign out
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    );
  }
  // Signed out. On the public paper site the primary action is "Play Now"
  // (opens Privy — no wallet needed). On the invite-only chain site we keep
  // the "Connect Wallet" framing. Both surface sign-in problems inline —
  // a silent failure here strands the player with a button that "does nothing".
  if (!chainOnly) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={promptPlayNow}
          disabled={busy}
          className="rounded bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Play Now"}
        </button>
        {authError && (
          <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-amber-500/40 bg-zinc-900 p-3 text-xs shadow-2xl">
            <p className="text-amber-200">{authError}</p>
            <div className="mt-2 flex items-center justify-end">
              <button
                onClick={clearAuthError}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => void signIn()}
        disabled={busy}
        className="rounded bg-lime-400 px-3 py-1 text-sm font-semibold text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
      >
        {busy ? "Signing…" : "Connect Wallet"}
      </button>
      {authError && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-amber-500/40 bg-zinc-900 p-3 text-xs shadow-2xl">
          <p className="text-amber-200">{authError}</p>
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={clearAuthError}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceRow({
  icon,
  label,
  value,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  accent: "lime" | "zinc";
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-zinc-900/60 px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm">
        <span className="text-lg">{icon}</span>
        <span className="font-bold text-zinc-400">{label}</span>
      </span>
      <span className={`font-mono font-black ${accent === "lime" ? "text-lime-300" : "text-zinc-200"}`}>
        {value}
      </span>
    </div>
  );
}

function PanelLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-zinc-200 hover:bg-zinc-800"
    >
      <span>{icon}</span>
      {label}
    </Link>
  );
}
