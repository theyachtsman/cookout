"use client";

/**
 * The Arena Wallet — a burner session key held in this browser.
 *
 * Solves the "confirm every trade" problem without custody: the player funds
 * the arena wallet ONCE from their main wallet (a single confirmation), and
 * from then on every pull-up / buy / sell / claim signs locally and goes
 * straight to the RPC — no prompts, near-zero latency. The private key never
 * leaves the browser and the house never touches the funds, so the
 * "platform can't rug you" pillar stays intact. Withdraw sweeps back to the
 * main wallet at any time.
 *
 * The key lives in localStorage: treat it like casino chips on the table —
 * only fund what you're actively playing with. The server is told the arena
 * address (POST /api/me/arena) so mirrored chain events credit your profile.
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
import { api } from "./api";

const STORE_KEY = "cookout:arena-key";
const HISTORY_KEY = "cookout:arena-history";

/** The chain the site plays on (Robinhood Chain Testnet for the dev phase). */
export const DEFAULT_CHAIN_ID = 46630;

/** One ledger row. Every deposit/trade/claim/withdraw runs through our own
 *  code, so this local log is a complete history of THIS browser's burner. */
export interface ArenaTxEntry {
  hash: string;
  kind:
    | "deposit"
    | "withdraw"
    | "pull-up"
    | "cancel"
    | "claim"
    | "buy"
    | "sell"
    | "redeem"
    | "approve";
  /** ETH moved (0 for approvals/cancels/claims where unknown). */
  eth: number;
  /** "arena" = signed locally (hot); "wallet" = injected-wallet confirmation. */
  via: "arena" | "wallet";
  chainId: number;
  at: number;
}

export function arenaHistory(): ArenaTxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as ArenaTxEntry[];
  } catch {
    return [];
  }
}

export function logArenaTx(entry: ArenaTxEntry): void {
  const list = arenaHistory();
  list.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-200)));
}

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

/** The arena address, creating the key on first use (and registering it). */
export function arenaAddress(): string {
  let key = localStorage.getItem(STORE_KEY) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(STORE_KEY, key);
    // Fire-and-forget: link burner → profile so XP credits the player.
    void api("/api/me/arena", { body: { address: privateKeyToAccount(key).address } }).catch(
      () => {},
    );
  }
  return privateKeyToAccount(key).address;
}

/** Re-register the link after sign-in (safe to call repeatedly). */
export async function registerArenaAddress(): Promise<void> {
  if (!hasArenaWallet()) return;
  await api("/api/me/arena", { body: { address: arenaAddress() } }).catch(() => {});
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

/**
 * Sign + send a call from the arena wallet — no wallet prompt. Returns once
 * the tx is confirmed so callers can refresh state.
 */
export async function arenaSend(
  chainId: number,
  to: `0x${string}`,
  data: `0x${string}`,
  valueWei = 0n,
): Promise<string> {
  const chain = chainOf(chainId);
  const client = pub(chainId);
  const acct = account();
  // Explicit legacy gas: custom/Orbit chains trip EIP-1559 fee estimation
  // (missing eth_maxPriorityFeePerGas, inflated defaults). gasPrice + a
  // padded estimate is boring and always works.
  const [gasPrice, gasEst] = await Promise.all([
    client.getGasPrice(),
    client.estimateGas({ account: acct.address, to, data, value: valueWei }),
  ]);
  const wallet = createWalletClient({ account: acct, chain, transport: http() });
  const hash = await wallet.sendTransaction({
    to,
    data,
    value: valueWei,
    gasPrice,
    gas: (gasEst * 13n) / 10n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("transaction reverted on-chain");
  return hash;
}

/** Sweep the arena wallet back to the player's main wallet (minus gas). */
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
  logArenaTx({ hash, kind: "withdraw", eth: Number(value) / 1e18, via: "arena", chainId, at: Date.now() });
  return hash;
}
