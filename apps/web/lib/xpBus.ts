"use client";

/** A tiny pub/sub so the global socket (social.tsx) can hand +XP events to the
 *  XP overlay without threading through React context. */
export interface XpGain {
  amount: number;
  total: number;
  level: number;
  source?: string;
}

type Listener = (e: XpGain) => void;
const listeners = new Set<Listener>();

export function emitXp(e: XpGain): void {
  for (const l of listeners) l(e);
}

export function onXp(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
