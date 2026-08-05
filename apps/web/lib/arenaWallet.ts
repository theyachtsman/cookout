"use client";

/**
 * LEGACY — the burner "arena wallet" that chain rounds used to be played from.
 *
 * Superseded by the Cookout Wallet (lib/cookoutWallet): the player's Privy
 * embedded wallet is now the one balance rounds spend, which removes both the
 * private key in localStorage and the awkward "fund your second wallet" step.
 *
 * What survives here is exactly two things:
 *   - enough to detect and sweep a burner that still holds funds, so nobody's
 *     ETH is stranded by the migration;
 *   - the paper-beta arena ledger, which is a different mechanism entirely
 *     (pETH bank ↔ stake) and is still live on the paper site.
 *
 * Nothing here signs a transaction for gameplay any more. Don't add to it.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { logWalletTx } from "./cookoutWallet";

const STORE_KEY = "cookout:arena-key";

/** The chain the site plays on (Robinhood Chain Testnet for the dev phase). */
export const DEFAULT_CHAIN_ID = 46630;

/**
 * Paper arena ledger — the pETH beta has no chain, so its deposits/withdrawals
 * are logged here per-browser (same shape, minus the chain fields). It gives
 * the paper wallet the same "here's your history" habit the mainnet one will.
 */
export interface PaperArenaTxEntry {
  kind: "deposit" | "withdraw";
  amount: number;
  /** Bank balance immediately after the move, for a running column. */
  bankAfter: number;
  arenaAfter: number;
  at: number;
}

const PAPER_HISTORY_KEY = "cookout:paper-arena-history";

export function paperArenaHistory(): PaperArenaTxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PAPER_HISTORY_KEY) ?? "[]") as PaperArenaTxEntry[];
  } catch {
    return [];
  }
}

export function logPaperArenaTx(entry: PaperArenaTxEntry): void {
  const list = paperArenaHistory();
  list.push(entry);
  localStorage.setItem(PAPER_HISTORY_KEY, JSON.stringify(list.slice(-200)));
}

/** Chain registry (mirror of chainTx's) — RPC the burner talks to directly. */
const CHAINS: Record<number, { name: string; rpc: string }> = {
  46630: { name: "Robinhood Chain Testnet", rpc: "https://rpc.testnet.chain.robinhood.com" },
};

function chainOf(chainId: number): Chain {
  const meta = CHAINS[chainId];
  if (!meta) throw new Error(`unsupported chain ${chainId}`);
  return defineChain({
    id: chainId,
    name: meta.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [meta.rpc] } },
  });
}

export function hasArenaWallet(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(STORE_KEY);
}

function account() {
  const key = localStorage.getItem(STORE_KEY) as `0x${string}` | null;
  if (!key) throw new Error("no arena wallet — fund one first");
  return privateKeyToAccount(key);
}

function pub(chainId: number): PublicClient {
  return createPublicClient({ chain: chainOf(chainId), transport: http() }) as PublicClient;
}

export async function arenaBalance(chainId: number): Promise<number> {
  if (!hasArenaWallet()) return 0;
  const bal = await pub(chainId).getBalance({ address: account().address });
  return Number(bal) / 1e18;
}

/** Native-token balance of any address (e.g. the player's Privy wallet). */
export async function balanceOf(chainId: number, address: string): Promise<number> {
  const bal = await pub(chainId).getBalance({ address: address as `0x${string}` });
  return Number(bal) / 1e18;
}

/** Sweep a leftover burner into the Cookout Wallet (minus gas). */
export async function arenaWithdraw(chainId: number, to: `0x${string}`): Promise<string> {
  const chain = chainOf(chainId);
  const client = pub(chainId);
  const acct = account();
  const bal = await client.getBalance({ address: acct.address });
  const gasPrice = await client.getGasPrice();
  const gasLimit = 30_000n; // simple transfer + margin for L2 pricing
  const value = bal - gasPrice * gasLimit * 2n;
  if (value <= 0n) throw new Error("nothing to withdraw");
  const wallet = createWalletClient({ account: acct, chain, transport: http() });
  const hash = await wallet.sendTransaction({ to, value, gas: gasLimit, gasPrice });
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  logWalletTx({
    hash,
    kind: "deposit",
    eth: Number(value) / 1e18,
    via: "cookout",
    chainId,
    at: Date.now(),
  });
  return hash;
}
