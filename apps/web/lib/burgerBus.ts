"use client";

/** A tiny pub/sub so the global socket (social.tsx) can hand 🍔 Burger awards to
 *  the Burger toast overlay + the balance count-up without threading React
 *  context. Mirrors xpBus. `balance` is the running $BURG total after the award. */
export interface BurgerGain {
  amount: number;
  balance: number;
  source: string;
  label: string;
}

type Listener = (e: BurgerGain) => void;
const listeners = new Set<Listener>();

export function emitBurger(e: BurgerGain): void {
  for (const l of listeners) l(e);
}

export function onBurger(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
