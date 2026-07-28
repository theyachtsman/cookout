"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * A small "by {creator}" chip so you can tell at a glance who made a coin. Takes
 * just the creator's address and resolves their name + avatar from the public
 * profile, cached across every card so a list of coins never refetches the same
 * creator. Links to their creator page. Falls back to a short address.
 */

const cache = new Map<string, { name?: string; avatarUrl?: string }>();
const inflight = new Map<string, Promise<void>>();

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function CreatorBadge({
  address,
  className = "",
}: {
  address: string;
  className?: string;
}) {
  const key = address.toLowerCase();
  const [info, setInfo] = useState<{ name?: string; avatarUrl?: string }>(
    () => cache.get(key) ?? {},
  );

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setInfo(cached);
      return;
    }
    let alive = true;
    let p = inflight.get(key);
    if (!p) {
      p = api<{ displayName?: string; avatarUrl?: string }>(`/api/profile/${key}`)
        .then((d) => {
          cache.set(key, { name: d.displayName, avatarUrl: d.avatarUrl });
        })
        .catch(() => {
          cache.set(key, {});
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    void p.then(() => {
      if (alive) setInfo(cache.get(key) ?? {});
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const display = info.name ?? shortAddr(address);
  return (
    <Link
      href={`/creator/${address}`}
      onClick={(e) => e.stopPropagation()}
      title={`Created by ${display}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-0.5 text-[11px] font-bold text-zinc-300 backdrop-blur transition hover:border-lime-400/60 hover:text-lime-300 ${className}`}
    >
      {info.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.avatarUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-zinc-800 text-[9px]">
          👤
        </span>
      )}
      <span className="truncate">by {display}</span>
    </Link>
  );
}
