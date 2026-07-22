import { PrivyClient } from "@privy-io/server-auth";

/**
 * Privy server-side verification.
 *
 * The browser authenticates with Privy (email / social / wallet — methods are
 * chosen in the Privy dashboard) and gets a short-lived access token. We NEVER
 * trust that token on its face: this module verifies it against Privy with the
 * app secret, then resolves the user's **embedded wallet** address, which is the
 * one identity we key every account to (XP, balance, history, and — at mainnet —
 * real funds). Email/social/wallet users all get one because the client is
 * configured to provision an embedded wallet for everyone.
 *
 * PRIVY_APP_ID / PRIVY_APP_SECRET live only in the server env (never shipped to
 * the browser). If they're unset the auth route reports 503 rather than crashing
 * the process, so a server without Privy configured still boots.
 */

let client: PrivyClient | null = null;

function getClient(): PrivyClient {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw Object.assign(new Error("Privy is not configured on this server"), { status: 503 });
  }
  if (!client) client = new PrivyClient(appId, appSecret);
  return client;
}

/** Minimal structural view of a Privy user (kept loose across SDK versions). */
interface PrivyLinkedAccount {
  type?: string;
  address?: string;
  walletClientType?: string;
  connectorType?: string;
}
export interface PrivyUserShape {
  linkedAccounts?: PrivyLinkedAccount[];
  email?: { address?: string };
  google?: { email?: string; name?: string };
  twitter?: { username?: string };
  discord?: { username?: string };
}

/**
 * The address we treat as the account's identity: the Privy-managed embedded
 * wallet if present, otherwise the first linked wallet (an external one the user
 * connected). Returns "" when the account has no wallet at all. Pure + exported
 * so it can be unit-tested without a live Privy client.
 */
export function embeddedAddressFromUser(user: PrivyUserShape): string {
  const wallets = (user.linkedAccounts ?? []).filter((a) => a.type === "wallet" && a.address);
  const embedded = wallets.find(
    (w) => w.walletClientType === "privy" || w.connectorType === "embedded",
  );
  return (embedded ?? wallets[0])?.address?.toLowerCase() ?? "";
}

/** A friendly default handle from whatever the user linked (email/social). */
export function displayNameFromUser(user: PrivyUserShape): string | undefined {
  const candidate =
    user.twitter?.username ??
    user.discord?.username ??
    user.google?.name ??
    (user.email?.address ?? user.google?.email)?.split("@")[0];
  return candidate ? String(candidate).slice(0, 24) : undefined;
}

export interface PrivyLogin {
  /** Embedded (or connected) wallet address, lowercased. */
  address: string;
  /** Suggested display name for a brand-new account. */
  displayName?: string;
}

/** Injectable at the app boundary so tests can stub Privy entirely. */
export type PrivyResolver = (accessToken: string) => Promise<PrivyLogin>;

/** Verify a Privy access token and resolve the account it belongs to. */
export const resolvePrivyLogin: PrivyResolver = async (accessToken) => {
  const privy = getClient();
  let userId: string;
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    userId = claims.userId;
  } catch {
    throw Object.assign(new Error("invalid or expired Privy session"), { status: 401 });
  }
  const user = (await privy.getUser(userId)) as unknown as PrivyUserShape;
  const address = embeddedAddressFromUser(user);
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw Object.assign(new Error("no wallet on this Privy account"), { status: 400 });
  }
  return { address, displayName: displayNameFromUser(user) };
};
