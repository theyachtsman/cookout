"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ACHIEVEMENTS, type PresenceStatus } from "@cookout/shared";
import { api } from "../lib/api";
import { useSocial } from "../lib/social";

/**
 * Player identity, everywhere. Any username on the site is clickable and
 * opens this card — the thing that turns anonymous wallets into recognizable
 * rivals. One card instance lives at the root; components call `openUser()`.
 */

export const STATUS_META: Record<PresenceStatus, { dot: string; label: string; cls: string }> = {
  hanging: { dot: "🟢", label: "Hanging out", cls: "text-emerald-400" },
  queue: { dot: "🔥", label: "In queue", cls: "text-orange-300" },
  trading: { dot: "📈", label: "Trading", cls: "text-lime-300" },
  spectating: { dot: "👀", label: "Spectating", cls: "text-sky-300" },
  finished: { dot: "🏆", label: "Finished a round", cls: "text-amber-300" },
};

interface Profile {
  address: string;
  displayName?: string;
  avatarUrl?: string;
  level: number;
  title: string;
  xp: number;
  achievements: string[];
  creatorReputation: number;
  jackpotWinnings?: number;
  stats: { roundsPlayed: number; wins: number; losses: number; trades: number; totalPnl: number };
}

const Ctx = createContext<{ openUser: (address: string) => void }>({ openUser: () => {} });
export const useUserCard = () => useContext(Ctx);

export function UserCardProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const openUser = useCallback((a: string) => setAddress(a), []);
  return (
    <Ctx.Provider value={{ openUser }}>
      {children}
      {address && <UserCard address={address} onClose={() => setAddress(null)} />}
    </Ctx.Provider>
  );
}

/** A username rendered as a button that opens the card. */
export function UserName({
  address,
  name,
  color,
  badge,
  className = "",
}: {
  address: string;
  name?: string;
  color?: string;
  badge?: string;
  className?: string;
}) {
  const { openUser } = useUserCard();
  const label = name ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <button
      onClick={() => openUser(address)}
      style={color ? { color } : undefined}
      className={`truncate font-bold hover:underline ${className}`}
      title="view player"
    >
      {badge && <span className="mr-1">{badge}</span>}
      {label}
    </button>
  );
}

function UserCard({ address, onClose }: { address: string; onClose: () => void }) {
  const { online } = useSocial();
  const [p, setP] = useState<Profile | null>(null);
  const [muted, setMuted] = useState(false);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    api<Profile>(`/api/profile/${address}`)
      .then(setP)
      .catch(() => {});
    // Follows/mutes are local for now — the graph lands with the feed.
    try {
      setFollowing(
        (JSON.parse(localStorage.getItem("cookout:following") ?? "[]") as string[]).includes(
          address.toLowerCase(),
        ),
      );
      setMuted(
        (JSON.parse(localStorage.getItem("cookout:muted-users") ?? "[]") as string[]).includes(
          address.toLowerCase(),
        ),
      );
    } catch {
      /* ignore */
    }
  }, [address]);

  const toggleList = (key: string, on: boolean) => {
    try {
      const list = new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
      if (on) list.add(address.toLowerCase());
      else list.delete(address.toLowerCase());
      localStorage.setItem(key, JSON.stringify([...list]));
    } catch {
      /* ignore */
    }
  };

  const presence = online.find((o) => o.address.toLowerCase() === address.toLowerCase());
  const status = presence ? STATUS_META[presence.status] : null;
  const unlocked = (p?.achievements ?? [])
    .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-[fadein_.2s_ease] rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {p?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.avatarUrl}
              alt=""
              className="h-14 w-14 rounded-full border border-zinc-700 object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xl">
              {(p?.displayName ?? address.slice(2, 4)).slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-black">
              {p?.displayName ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
            </div>
            <div className="text-xs text-zinc-500">
              Lv {p?.level ?? "–"} · {p?.title ?? "…"}
            </div>
            {status && (
              <div className={`mt-0.5 text-xs font-bold ${status.cls}`}>
                {status.dot} {status.label}
                {presence?.roundSymbol && (
                  <>
                    {" in "}
                    {presence.roundId ? (
                      <Link
                        href={`/round/${presence.roundId}`}
                        onClick={onClose}
                        className="underline hover:text-zinc-200"
                      >
                        ${presence.roundSymbol}
                      </Link>
                    ) : (
                      `$${presence.roundSymbol}`
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ["XP", p ? p.xp.toLocaleString() : "–"],
            ["Rounds", p ? String(p.stats.roundsPlayed) : "–"],
            ["Wins", p ? String(p.stats.wins) : "–"],
            ["Trades", p ? String(p.stats.trades) : "–"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-zinc-900 p-2">
              <div className="text-[9px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className="font-mono text-sm font-bold">{v}</div>
            </div>
          ))}
        </div>

        {unlocked.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Badges</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {unlocked.map((a) => (
                <span
                  key={a!.id}
                  title={a!.description}
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300"
                >
                  {a!.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => {
              const next = !following;
              setFollowing(next);
              toggleList("cookout:following", next);
            }}
            className={`flex-1 rounded-lg py-2 text-sm font-black ${
              following
                ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                : "bg-lime-400 text-zinc-950 hover:bg-lime-300"
            }`}
          >
            {following ? "✓ Following" : "+ Follow"}
          </button>
          <Link
            href={`/profile/${address}`}
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-bold text-zinc-300 hover:border-zinc-500"
          >
            Profile
          </Link>
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              toggleList("cookout:muted-users", next);
            }}
            title={muted ? "unmute in chat" : "mute in chat"}
            className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-500 hover:text-zinc-200"
          >
            {muted ? "🔇" : "🔈"}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Follows and mutes are saved in this browser.
        </p>
      </div>
    </div>
  );
}
