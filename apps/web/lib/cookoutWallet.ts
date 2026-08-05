"use client";

/**
 * The Cookout Wallet — the player's Privy embedded wallet, used directly.
 *
 * This replaces the old browser-burner ("arena wallet") model on the chain-only
 * site. There is now exactly one balance: the Privy wallet's. Players deposit
 * ETH into it from anywhere, every pull-up / buy / sell / claim spends from it,
 * and they can send back out to any address. One address, one balance, one
 * ledger — nothing to "fund into" and nothing stranded in a second wallet.
 *
 * Privy keeps the key; the app never sees it, and `showWalletUIs: false` in the
 * provider config means signing is silent, so trades keep the no-prompt feel the
 * burner was invented for — without the custody-shaped footgun of a private key
 * sitting in localStorage.
 *
 * React can't reach into the plain functions in `chainTx.ts`, so a bridge
 * component (CookoutWalletBridge) publishes the live provider here and these
 * functions read it. `signerReady()` is false until that happens: callers fall
 * back to an injected wallet, which is what external-wallet logins use.
 */

import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";

/** The chain the site plays on (Robinhood Chain Testnet for the dev phase). */
export const DEFAULT_CHAIN_ID = 46630;

const CHAINS: Record<number, { name: string; rpc: string }> = {
  46630: { name: "Robinhood Chain Testnet", rpc: "https://rpc.testnet.chain.robinhood.com" },
};

export function chainOf(chainId: number): Chain {
  const meta = CHAINS[chainId];
  if (!meta) throw new Error(`unsupported chain ${chainId}`);
  return defineChain({
    id: chainId,
    name: meta.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [meta.rpc] } },
  });
}

export function publicClientFor(chainId: number): PublicClient {
  return createPublicClient({ chain: chainOf(chainId), transport: http() }) as PublicClient;
}

// ---------------- the ledger ----------------

/**
 * One ledger row. Every deposit / trade / claim / send runs through our own
 * code, so this local log is a complete history of the wallet's activity from
 * this browser. The storage key is inherited from the burner era on purpose —
 * players keep the history they already had.
 */
export interface WalletTxEntry {
  hash: string;
  kind:
    | "deposit"
    | "withdraw"
    | "send"
    | "pull-up"
    | "cancel"
    | "claim"
    | "buy"
    | "sell"
    | "redeem"
    | "approve";
  /** ETH moved (0 for approvals/cancels/claims where unknown). */
  eth: number;
  /** "cookout" = signed by the Cookout Wallet; "wallet" = an external wallet. */
  via: "cookout" | "arena" | "wallet";
  chainId: number;
  at: number;
  /** Counterparty, for sends. */
  to?: string;
}

const HISTORY_KEY = "cookout:arena-history";

export function walletHistory(): WalletTxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as WalletTxEntry[];
  } catch {
    return [];
  }
}

export function logWalletTx(entry: WalletTxEntry): void {
  const list = walletHistory();
  list.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-200)));
}

// ---------------- the signer bridge ----------------

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

interface Signer {
  provider: Eip1193;
  address: `0x${string}`;
}

let signer: Signer | null = null;
const listeners = new Set<() => void>();

/** Published by CookoutWalletBridge whenever the embedded wallet is ready. */
export function setCookoutSigner(next: { provider: Eip1193; address: string } | null): void {
  const addr = next ? (next.address.toLowerCase() as `0x${string}`) : null;
  if (signer?.address === addr && signer?.provider === next?.provider) return;
  signer = next && addr ? { provider: next.provider, address: addr } : null;
  for (const fn of listeners) fn();
}

/** Subscribe to signer availability (used by UI that must wait for it). */
export function onCookoutSigner(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function signerReady(): boolean {
  return !!signer;
}

/** The Cookout Wallet address, or null before the embedded wallet resolves. */
export function cookoutAddress(): `0x${string}` | null {
  return signer?.address ?? null;
}

function need(): Signer {
  if (!signer) throw new Error("Cookout Wallet isn't ready yet — reload and sign in again");
  return signer;
}

// ---------------- balances ----------------

/** Native-token balance of any address. */
export async function balanceOf(chainId: number, address: string): Promise<number> {
  const bal = await publicClientFor(chainId).getBalance({ address: address as `0x${string}` });
  return Number(bal) / 1e18;
}

export async function cookoutBalance(chainId = DEFAULT_CHAIN_ID): Promise<number> {
  const s = signer;
  if (!s) return 0;
  return balanceOf(chainId, s.address);
}

/**
 * Read-only contract call over the public RPC.
 *
 * Deliberately not routed through a wallet: reads have no signer and must work
 * for everyone. The old path went through window.ethereum, which meant a
 * Privy-only player — now the common case — hit "No wallet found" just for
 * reading an allowance or a token balance.
 */
export async function ethCall(chainId: number, to: string, data: string): Promise<string> {
  const res = await publicClientFor(chainId).call({
    to: to as `0x${string}`,
    data: data as `0x${string}`,
  });
  return res.data ?? "0x";
}

export async function cookoutBalanceWei(chainId = DEFAULT_CHAIN_ID): Promise<bigint> {
  const s = signer;
  if (!s) return 0n;
  return publicClientFor(chainId).getBalance({ address: s.address });
}

// ---------------- sending ----------------

/**
 * Sign + send from the Cookout Wallet and wait for the receipt.
 *
 * Gas is priced explicitly (legacy gasPrice + a padded estimate) for the same
 * reason the burner did it: custom/Orbit chains trip EIP-1559 estimation, which
 * either errors on the missing eth_maxPriorityFeePerGas or quotes an absurd fee.
 */
export async function cookoutSend(
  chainId: number,
  to: `0x${string}`,
  data: `0x${string}` = "0x",
  valueWei = 0n,
  gasLimit?: bigint,
): Promise<string> {
  const s = need();
  const client = publicClientFor(chainId);
  const [gasPrice, gasEst] = await Promise.all([
    client.getGasPrice(),
    gasLimit
      ? Promise.resolve(gasLimit)
      : client.estimateGas({ account: s.address, to, data, value: valueWei }),
  ]);
  const gas = gasLimit ?? (gasEst * 13n) / 10n;
  const hash = (await s.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: s.address,
        to,
        data,
        ...(valueWei > 0n ? { value: "0x" + valueWei.toString(16) } : {}),
        gas: "0x" + gas.toString(16),
        gasPrice: "0x" + gasPrice.toString(16),
      },
    ],
  })) as `0x${string}`;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("transaction reverted on-chain");
  return hash;
}

/** Gas a plain ETH transfer needs, priced now. Used to compute "send max". */
export async function transferGasCostWei(chainId = DEFAULT_CHAIN_ID): Promise<bigint> {
  const gasPrice = await publicClientFor(chainId).getGasPrice();
  // 21k is the exact cost of a value transfer; double it as the reserve so a
  // gas-price tick between quoting Max and mining the tx can't strand the send.
  return gasPrice * 21_000n * 2n;
}

/**
 * Send ETH out of the Cookout Wallet to any address.
 *
 * `max` sweeps the balance minus the gas reserve, which is the only way to
 * actually empty the wallet — asking for the full balance always fails, because
 * the fee has to come from the same pot.
 */
export async function cookoutTransfer(
  chainId: number,
  to: string,
  amountEth: string,
  max = false,
): Promise<{ hash: string; sent: number }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) throw new Error("that isn't a valid 0x address");
  const dest = to.trim() as `0x${string}`;
  if (dest.toLowerCase() === need().address) throw new Error("that's this wallet's own address");

  const [balance, reserve] = await Promise.all([
    cookoutBalanceWei(chainId),
    transferGasCostWei(chainId),
  ]);
  const value = max ? balance - reserve : toWeiExact(amountEth);
  if (value <= 0n) throw new Error("nothing to send after gas");
  if (value + reserve > balance)
    throw new Error(
      `not enough ETH — you can send up to ${(Number(balance - reserve) / 1e18).toFixed(6)} ` +
        `after leaving gas for the transaction`,
    );

  const hash = await cookoutSend(chainId, dest, "0x", value, 21_000n);
  const sent = Number(value) / 1e18;
  logWalletTx({ hash, kind: "send", eth: sent, via: "cookout", chainId, at: Date.now(), to: dest });
  return { hash, sent };
}

/** Decimal string → wei, exact (no float math). */
export function toWeiExact(dec: string | number): bigint {
  const s = String(dec).trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`bad amount: ${dec}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}
