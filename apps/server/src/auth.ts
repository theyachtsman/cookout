import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { verifyMessage } from "viem";
import type { Store } from "./store.js";

/**
 * Wallet-based auth (spec §11): the only identity is an EVM address.
 * nonce → personal_sign → session token. No usernames, no passwords,
 * no deposits — signing proves key ownership, nothing moves on chain.
 */
export function nonceMessage(address: string, nonce: string): string {
  return `The Cookout wants you to sign in.\n\nAddress: ${address}\nNonce: ${nonce}\n\nThis signature only proves wallet ownership. It authorizes no transaction.`;
}

export function issueNonce(store: Store, address: string): string {
  const nonce = randomBytes(16).toString("hex");
  store.nonces.set(address.toLowerCase(), nonce);
  return nonce;
}

export async function verifyAndCreateSession(
  store: Store,
  address: string,
  signature: `0x${string}`,
  referralCode?: string,
): Promise<{ token: string }> {
  const key = address.toLowerCase();
  const nonce = store.nonces.get(key);
  if (!nonce) throw Object.assign(new Error("no nonce issued"), { status: 400 });
  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: nonceMessage(address, nonce),
    signature,
  });
  if (!valid) throw Object.assign(new Error("invalid signature"), { status: 401 });
  store.nonces.delete(key);
  // Beta-period gate: with BETA_WHITELIST=1, only signed-up wallets (or
  // wallets that already have profiles) may create sessions.
  if (
    process.env.BETA_WHITELIST === "1" &&
    !store.users.has(key) &&
    !store.betaSignups.get(key)?.approved
  ) {
    throw Object.assign(
      new Error("this wallet is not on the beta whitelist — sign up on the landing page"),
      { status: 403 },
    );
  }
  const referrer = referralCode ? store.userByReferralCode(referralCode) : undefined;
  const isNew = !store.users.has(key);
  store.getOrCreateUser(key, isNew ? referrer?.address : undefined);
  if (isNew && referrer && referrer.address !== key) referrer.referralCount++;
  const token = randomBytes(24).toString("hex");
  store.sessions.set(token, key);
  return { token };
}

export interface AuthedRequest extends Request {
  userAddress?: string;
}

export function requireAuth(store: Store) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const address = token ? store.sessions.get(token) : undefined;
    if (!address) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    req.userAddress = address;
    next();
  };
}

export function requireAdmin(adminKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-admin-key"] !== adminKey) {
      res.status(403).json({ error: "admin key required" });
      return;
    }
    next();
  };
}
