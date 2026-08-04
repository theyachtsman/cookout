"use client";

import Link from "next/link";
import type { KillFeedActor } from "@cookout/shared";

/**
 * The face on an event. Kill-feed events about a specific person (right now:
 * every developer buy and sell) carry their profile picture and name, so an
 * alert reads as "this person did this" instead of an anonymous line in the
 * tape. A dev selling their own coin is the moment traders most need to
 * recognise on sight, so it always gets a face — falling back to the first
 * letter of their name when they haven't set a picture.
 */
export function ActorFace({
  actor,
  size = 18,
  ring = "ring-orange-400/70",
}: {
  actor: KillFeedActor;
  size?: number;
  /** Tailwind ring color — orange for sells, lime for buys. */
  ring?: string;
}) {
  const name = actor.displayName ?? `${actor.address.slice(0, 6)}…${actor.address.slice(-4)}`;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };
  return actor.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={actor.avatarUrl}
      alt={name}
      title={name}
      style={style}
      className={`shrink-0 rounded-full object-cover ring-1 ${ring}`}
    />
  ) : (
    <span
      title={name}
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-700 font-black uppercase leading-none text-zinc-200 ring-1 ${ring}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** The face plus a linked name — for surfaces with room for both. */
export function ActorTag({
  actor,
  size = 18,
  ring,
  className = "",
}: {
  actor: KillFeedActor;
  size?: number;
  ring?: string;
  className?: string;
}) {
  const name = actor.displayName ?? `${actor.address.slice(0, 6)}…${actor.address.slice(-4)}`;
  return (
    <Link
      href={`/profile/${actor.address}`}
      onClick={(e) => e.stopPropagation()}
      className={`pointer-events-auto inline-flex items-center gap-1.5 hover:underline ${className}`}
    >
      <ActorFace actor={actor} size={size} ring={ring} />
      <span className="font-black">{name}</span>
    </Link>
  );
}
