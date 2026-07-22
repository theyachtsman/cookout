"use client";

/**
 * The Arena Account key — a self-custodied identity generated in this browser.
 *
 * This is the pragmatic "account abstraction" for the paper Open Beta: a brand
 * new player never needs a crypto wallet. On "Play Now" we mint an EVM keypair
 * locally, and it signs the SIWE login challenge itself — no MetaMask popup, no
 * seed phrase, no whitelist. The server only ever sees an address + signature,
 * so this slots straight into the existing nonce → verify auth. At mainnet the
 * key backend can be swapped for a real smart account without touching auth.
 *
 * Deliberately SEPARATE from the on-chain trading burner in arenaWallet.ts:
 * this key is *who you are* (login identity), the burner is *chips on the
 * table* (funds you're actively playing with). Keeping them apart means an
 * "export/backup your account" flow never leaks trading funds and vice versa.
 *
 * The key lives in localStorage. It is the player's account, so losing this
 * browser's storage loses the account — the Export flow exists so they can
 * back it up. Treat it like a game save, not a bank vault (it's paper money).
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const STORE_KEY = "cookout:account-key";

type Hex = `0x${string}`;

function readKey(): Hex | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORE_KEY) as Hex | null;
}

/** True once this browser has minted an arena account (does not create one). */
export function hasAccount(): boolean {
  return !!readKey();
}

/** The account address, minting the key on first use. */
export function accountAddress(): string {
  let key = readKey();
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(STORE_KEY, key);
  }
  return privateKeyToAccount(key).address;
}

/** Sign an arbitrary SIWE message with the arena account key (no prompt). */
export async function signWithAccount(message: string): Promise<Hex> {
  const key = readKey() ?? (accountAddress(), readKey());
  if (!key) throw new Error("no arena account");
  return privateKeyToAccount(key).signMessage({ message });
}

/** The raw private key, for the "Export / back up your account" flow. */
export function exportAccountKey(): Hex | null {
  return readKey();
}

/** Wipe the local account (used when signing out of a locally-minted account). */
export function clearAccount(): void {
  if (typeof window !== "undefined") localStorage.removeItem(STORE_KEY);
}
