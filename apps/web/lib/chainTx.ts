"use client";

/**
 * Wallet transactions for on-chain (Phase 2) rounds.
 *
 * Players trade chain rounds from their own wallets — the server only mirrors.
 * This module hand-encodes the handful of static-arg calls the round contracts
 * expose, so the web bundle needs no web3 library.
 *
 * AUDIT POLICY (docs/COMPLIANCE + 2026-07 audit): token approvals are always
 * EXACT-AMOUNT and always target the specific per-round contract (the round's
 * own pool for sell, its own pool for redeem). Never a shared router, never a
 * multicall helper, never infinite approvals. That policy is what keeps this
 * launchpad immune to the Multicall3-style approval-drain class.
 */

import type { Round } from "@cookout/shared";
import {
  arenaAddress,
  arenaBalance,
  arenaSend,
  hasArenaWallet,
  logArenaTx,
  type ArenaTxEntry,
} from "./arenaWallet";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Chains the wallet may be asked to switch to, keyed by chain id. */
const CHAINS: Record<number, { name: string; rpc: string; explorer?: string }> = {
  46630: {
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
  },
};

// 4-byte selectors (keccak-256 of the canonical signature, precomputed).
const SEL = {
  submit: "0x2839d5f3", // submit(uint128)
  cancel: "0x40e58ee5", // cancel(uint256)
  claim: "0x379607f5", // claim(uint256)
  buy: "0xd96a094a", // buy(uint256)
  sell: "0xd79875eb", // sell(uint256,uint256)
  redeem: "0xdb006a75", // redeem(uint256)
  approve: "0x095ea7b3", // approve(address,uint256)
  balanceOf: "0x70a08231", // balanceOf(address)
  allowance: "0xdd62ed3e", // allowance(address,address)
} as const;

function eth(): Eth {
  const e = (window as unknown as { ethereum?: Eth }).ethereum;
  if (!e) throw new Error("No wallet found — install MetaMask (or similar) to trade this round");
  return e;
}

/** Decimal string → wei bigint, exact (no float math). */
export function toWei(dec: string | number): bigint {
  const s = String(dec).trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`bad amount: ${dec}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function fromWei(hexOrBig: string | bigint): number {
  const v = typeof hexOrBig === "bigint" ? hexOrBig : BigInt(hexOrBig);
  return Number(v) / 1e18;
}

const pad32 = (v: bigint | string): string =>
  (typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "").toLowerCase()).padStart(64, "0");

async function account(): Promise<string> {
  const accs = (await eth().request({ method: "eth_requestAccounts" })) as string[];
  if (!accs[0]) throw new Error("wallet has no account connected");
  return accs[0];
}

/** Make sure the wallet is on the round's chain (switch, adding if unknown). */
export async function ensureChain(chainId: number): Promise<void> {
  const hexId = "0x" + chainId.toString(16);
  try {
    await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    const meta = CHAINS[chainId];
    if (!meta) throw new Error(`wallet is on the wrong network (need chain ${chainId})`);
    await eth().request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: meta.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [meta.rpc],
          ...(meta.explorer ? { blockExplorerUrls: [meta.explorer] } : {}),
        },
      ],
    });
    await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  }
}

/** True when the arena wallet should carry this round's transactions: it
 *  exists and holds enough to cover the call (plus a little gas). Hot path =
 *  local signing, zero wallet prompts. */
export async function arenaActive(chainId: number, needEth = 0): Promise<boolean> {
  if (!hasArenaWallet()) return false;
  try {
    // Gas here is ~0.01 gwei, so a generous reserve is still microscopic —
    // a fat buffer would stop small testnet balances from ever going hot.
    return (await arenaBalance(chainId)) >= needEth + 0.00002;
  } catch {
    return false;
  }
}

/** The address whose trades/holdings are "you" for this round — the arena
 *  wallet when active, else the injected wallet. */
export async function activeTradeAddress(chainId: number): Promise<string> {
  return (await arenaActive(chainId)) ? arenaAddress() : account();
}

async function sendVia(
  chainId: number,
  to: string,
  data: string,
  valueWei = 0n,
  kind: ArenaTxEntry["kind"] = "approve",
  ethMoved = Number(valueWei) / 1e18,
): Promise<string> {
  let hash: string;
  let via: ArenaTxEntry["via"];
  if (await arenaActive(chainId, Number(valueWei) / 1e18)) {
    via = "arena";
    hash = await arenaSend(chainId, to as `0x${string}`, data as `0x${string}`, valueWei);
  } else {
    via = "wallet";
    await ensureChain(chainId);
    hash = await sendTx(to, data, valueWei);
  }
  logArenaTx({ hash, kind, eth: ethMoved, via, chainId, at: Date.now() });
  return hash;
}

async function sendTx(to: string, data: string, valueWei = 0n, gas?: bigint): Promise<string> {
  const from = await account();
  const hash = (await eth().request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to,
        data,
        ...(valueWei > 0n ? { value: "0x" + valueWei.toString(16) } : {}),
        // Pinning gas stops wallets from over-estimating on custom chains
        // and blocking the confirm with a bogus "insufficient gas".
        ...(gas ? { gas: "0x" + gas.toString(16) } : {}),
      },
    ],
  })) as string;
  // Wait for the receipt so the caller can refresh state knowing it landed.
  for (let i = 0; i < 60; i++) {
    const r = (await eth().request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (r) {
      if (r.status === "0x0") throw new Error("transaction reverted on-chain");
      return hash;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("transaction not confirmed after 90s — check your wallet activity");
}

async function call(to: string, data: string): Promise<string> {
  return (await eth().request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  })) as string;
}

// ---------------- public per-round actions ----------------

/** Queue: escrow real ETH into the round's batch auction. maxPrice (ETH per
 *  token) is optional — 0 encodes a market intent, same as the paper engine. */
export async function chainSubmitIntent(
  round: Round,
  ethAmount: string,
  maxPrice?: string,
): Promise<string> {
  const c = round.chain!;
  const priceWad = maxPrice ? toWei(maxPrice) : 0n;
  return sendVia(c.chainId, c.auction, SEL.submit + pad32(priceWad), toWei(ethAmount), "pull-up");
}

export async function chainCancelIntent(round: Round, intentId: string): Promise<string> {
  const c = round.chain!;
  return sendVia(c.chainId, c.auction, SEL.cancel + pad32(BigInt(intentId)), 0n, "cancel");
}

/** After settlement: pull your tokens + refund for one intent. */
export async function chainClaimFill(round: Round, intentId: string): Promise<string> {
  const c = round.chain!;
  return sendVia(c.chainId, c.auction, SEL.claim + pad32(BigInt(intentId)), 0n, "claim");
}

/** Live trading: buy with real ETH. minTokensOut=0 — testnet convenience; a
 *  mainnet build must quote and pass a real slippage floor. */
export async function chainBuy(round: Round, ethAmount: string): Promise<string> {
  const c = round.chain!;
  return sendVia(c.chainId, c.pool, SEL.buy + pad32(0n), toWei(ethAmount), "buy");
}

/** Live trading: sell tokens. Exact-amount approval to this round's pool,
 *  then sell — never more than this trade needs (audit policy). */
export async function chainSell(round: Round, tokensWei: bigint): Promise<string> {
  const c = round.chain!;
  const me = await activeTradeAddress(c.chainId);
  const allowance = BigInt(
    await call(c.token, SEL.allowance + pad32(me) + pad32(c.pool)),
  );
  if (allowance < tokensWei) {
    await sendVia(c.chainId, c.token, SEL.approve + pad32(c.pool) + pad32(tokensWei));
  }
  return sendVia(c.chainId, c.pool, SEL.sell + pad32(tokensWei) + pad32(0n), 0n, "sell");
}

/** Non-graduated round over: redeem remaining tokens at the uniform price.
 *  Exact-amount approval to this round's pool only. */
export async function chainRedeem(round: Round, tokensWei: bigint): Promise<string> {
  const c = round.chain!;
  const me = await activeTradeAddress(c.chainId);
  const allowance = BigInt(
    await call(c.token, SEL.allowance + pad32(me) + pad32(c.pool)),
  );
  if (allowance < tokensWei) {
    await sendVia(c.chainId, c.token, SEL.approve + pad32(c.pool) + pad32(tokensWei));
  }
  return sendVia(c.chainId, c.pool, SEL.redeem + pad32(tokensWei), 0n, "redeem");
}

// ---------------- balances ----------------

/** Spendable balance for this round: arena wallet when hot, else injected. */
export async function walletEthBalance(chainId?: number): Promise<number> {
  if (chainId && (await arenaActive(chainId))) return arenaBalance(chainId);
  const me = await account();
  return fromWei(
    (await eth().request({ method: "eth_getBalance", params: [me, "latest"] })) as string,
  );
}

/** Raw wei balance of the round token (wei precision matters for sell-all),
 *  read for whichever address is trading this round. */
export async function walletTokenBalanceWei(round: Round): Promise<bigint> {
  const me = await activeTradeAddress(round.chain!.chainId);
  return BigInt(await call(round.chain!.token, SEL.balanceOf + pad32(me)));
}

/** One-time funding: a single injected-wallet confirmation moves ETH into the
 *  arena wallet; every trade after that signs locally with no prompts. */
export async function fundArenaWallet(chainId: number, ethAmount: string): Promise<string> {
  await ensureChain(chainId);
  const value = toWei(ethAmount);
  // Pre-check the payer so a short balance gives a useful message instead of
  // the wallet's opaque gas-block (the connected account may not be the
  // funded one — people juggle test wallets).
  const from = await account();
  const bal = BigInt(
    (await eth().request({ method: "eth_getBalance", params: [from, "latest"] })) as string,
  );
  if (bal < value + toWei("0.00005")) {
    throw new Error(
      `connected wallet ${from.slice(0, 6)}…${from.slice(-4)} holds ${fromWei(bal).toFixed(5)} ` +
        `ETH on this chain — switch to a funded account or claim the faucet`,
    );
  }
  const hash = await sendTx(arenaAddress(), "0x", value, 21_000n);
  logArenaTx({
    hash,
    kind: "deposit",
    eth: fromWei(value),
    via: "wallet",
    chainId,
    at: Date.now(),
  });
  return hash;
}
