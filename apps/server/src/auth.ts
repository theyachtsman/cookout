import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { verifyMessage } from "viem";
import { SESSION_TTL_MS, type Store } from "./store.js";

/**
 * Wallet-based auth (spec §11): the only identity is an EVM address.
 * nonce → personal_sign → session token. No usernames, no passwords,
 * no deposits — signing proves key ownership, nothing moves on chain.
 *
 * The message is EIP-4361 (Sign-In with Ethereum): domain-bound so a
 * signature phished on another site never verifies here, and expiring so a
 * leaked message goes stale. Set SIWE_DOMAIN/SIWE_URI to the public origin
 * in production; the wallet shows the domain, so a mismatch is user-visible.
 */
const SIWE_DOMAIN = process.env.SIWE_DOMAIN ?? "localhost:3000";
const SIWE_URI = process.env.SIWE_URI ?? `http://${SIWE_DOMAIN}`;
const SIWE_CHAIN_ID = process.env.SIWE_CHAIN_ID ?? "1";
const NONCE_TTL_MS = 5 * 60 * 1000;

/** Dev wallets always bypass the beta whitelist (comma-separated addresses). */
const DEV_WALLETS = new Set(
  (process.env.DEV_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
export const isDevWallet = (address: string): boolean => DEV_WALLETS.has(address.toLowerCase());

export function nonceMessage(address: string, nonce: string, issuedAtMs: number): string {
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "This signature only proves wallet ownership. It authorizes no transaction and moves no funds.",
    "",
    `URI: ${SIWE_URI}`,
    "Version: 1",
    `Chain ID: ${SIWE_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAtMs).toISOString()}`,
    `Expiration Time: ${new Date(issuedAtMs + NONCE_TTL_MS).toISOString()}`,
  ].join("\n");
}

export function issueNonce(store: Store, address: string): { nonce: string; message: string } {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  store.nonces.set(address.toLowerCase(), { nonce, issuedAt });
  return { nonce, message: nonceMessage(address, nonce, issuedAt) };
}

export async function verifyAndCreateSession(
  store: Store,
  address: string,
  signature: `0x${string}`,
  referralCode?: string,
): Promise<{ token: string }> {
  const key = address.toLowerCase();
  const pending = store.nonces.get(key);
  if (!pending) throw Object.assign(new Error("no nonce issued"), { status: 400 });
  if (Date.now() - pending.issuedAt > NONCE_TTL_MS) {
    store.nonces.delete(key);
    throw Object.assign(new Error("sign-in message expired — request a new one"), { status: 400 });
  }
  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: nonceMessage(address, pending.nonce, pending.issuedAt),
    signature,
  });
  if (!valid) throw Object.assign(new Error("invalid signature"), { status: 401 });
  store.nonces.delete(key);
  // Beta-period gate: with BETA_WHITELIST=1, only dev wallets, approved
  // whitelist wallets, or wallets that already have profiles may create
  // sessions. Collected-but-unapproved signups are held out until launch.
  if (
    process.env.BETA_WHITELIST === "1" &&
    !isDevWallet(key) &&
    !store.users.has(key) &&
    !store.betaSignups.get(key)?.approved
  ) {
    throw Object.assign(
      new Error(
        "The Cookout is in private beta. Your wallet is on the list — we'll open access at launch.",
      ),
      { status: 403 },
    );
  }
  const referrer = referralCode ? store.userByReferralCode(referralCode) : undefined;
  const isNew = !store.users.has(key);
  store.getOrCreateUser(key, isNew ? referrer?.address : undefined);
  if (isNew && referrer && referrer.address !== key) referrer.referralCount++;
  const token = randomBytes(24).toString("hex");
  store.sessions.set(token, { address: key, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token };
}

export interface AuthedRequest extends Request {
  userAddress?: string;
}

export function requireAuth(store: Store) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const address = token ? store.sessionAddress(token) : undefined;
    if (!address) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    req.userAddress = address;
    next();
  };
}

export function requireAdmin(adminKey: string) {
  const expected = Buffer.from(adminKey);
  return (req: Request, res: Response, next: NextFunction) => {
    const given = Buffer.from(String(req.headers["x-admin-key"] ?? ""));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(403).json({ error: "admin key required" });
      return;
    }
    next();
  };
}
