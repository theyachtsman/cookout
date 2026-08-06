"use client";

import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { api } from "../../lib/api";
import {
  cookoutAddress,
  cookoutSend,
  gasCostOf,
  logWalletTx,
  publicClientFor,
  signerReady,
} from "../../lib/cookoutWallet";

/**
 * "Mint this recruit" — the optional second step.
 *
 * Pulling stays instant and off-chain, exactly as it is: the crate opens, the
 * card is yours, nothing waits on a wallet. This is for the player who also
 * wants the token, and they pay their own gas for it.
 *
 * Deliberately not part of the crate cinematic. A wallet confirmation in the
 * middle of the animation would interrupt the one moment the feature exists
 * for, and it would tax every player who does not care about NFTs on every
 * single pull. Here it is a button on a card they already own, pressed when
 * they feel like it.
 */

const SPENT_ABI = [
  {
    type: "function",
    name: "voucherSpent",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "cardId", type: "string" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "cardId", type: "string" },
      { name: "nonce", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

interface Voucher {
  signature: `0x${string}`;
  contract: string;
  chainId: number;
  cardId: string;
  nonce: number;
  cardName: string;
}

export function MintRecruit({
  cardId,
  cardName,
  quantity,
}: {
  cardId: string;
  cardName: string;
  /** Copies owned — each can be minted once. */
  quantity: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /**
   * Which copy to mint next, read from the chain.
   *
   * The button used to always ask for copy 1 and only remember success in
   * local state, so a reload brought it straight back and pressing it spent a
   * voucher that was already gone — the transaction reverted with no useful
   * message. The contract exposes voucherSpent precisely so a button that
   * could only fail is never shown; it just was not being asked.
   *
   * null = still checking, 0 = every copy is already minted.
   */
  const [nextCopy, setNextCopy] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const me = cookoutAddress();
    const contract = process.env.NEXT_PUBLIC_NFT_CONTRACT;
    if (!me) return;
    try {
      // Ask the API where the collection lives rather than hardcoding it, so a
      // redeploy does not silently point the UI at a dead contract.
      const cfg = await api<{ contract?: string; chainId?: number }>("/api/collection/mint-config");
      const addr = (cfg.contract ?? contract) as `0x${string}` | undefined;
      if (!addr) {
        setNextCopy(0);
        return;
      }
      const client = publicClientFor(cfg.chainId ?? 46630);
      for (let copy = 1; copy <= quantity; copy++) {
        const spent = (await client.readContract({
          address: addr,
          abi: SPENT_ABI,
          functionName: "voucherSpent",
          args: [me, cardId, BigInt(copy)],
        })) as boolean;
        if (!spent) {
          setNextCopy(copy);
          return;
        }
      }
      setNextCopy(0); // all minted
    } catch {
      // A failed read should not hide a button that might work.
      setNextCopy(1);
    }
  }, [cardId, quantity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mint = async (copy: number) => {
    setBusy(true);
    setError("");
    try {
      // The server signs only for cards the crates actually gave you; the
      // contract mints nothing without that signature.
      const v = await api<Voucher>("/api/collection/mint-voucher", {
        body: { cardId, copy },
      });
      const data = encodeFunctionData({
        abi: MINT_ABI,
        functionName: "mint",
        args: [v.cardId, BigInt(v.nonce), v.signature],
      });
      const hash = await cookoutSend(v.chainId, v.contract as `0x${string}`, data);
      // A mint moves no ETH, so its whole cost is gas — recorded from the
      // receipt rather than estimated, or it would show in the wallet history
      // as a free action.
      logWalletTx({
        hash,
        kind: "mint",
        eth: -(await gasCostOf(v.chainId, hash)),
        via: "cookout",
        chainId: v.chainId,
        at: Date.now(),
        to: v.contract,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Nothing to offer until the wallet is ready — a button that can only fail
  // is worse than no button.
  if (!signerReady()) return null;

  if (nextCopy === null) return null; // still reading the chain
  if (nextCopy === 0)
    return (
      <div className="rounded-xl bg-lime-400/10 p-2.5 text-center text-xs font-bold text-lime-300 ring-1 ring-lime-400/30">
        {quantity > 1 ? `All ${quantity} copies minted` : "Minted"} — it&apos;s in your wallet.
      </div>
    );

  return (
    <div>
      <button
        disabled={busy}
        onClick={() => void mint(nextCopy)}
        className="w-full rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-black text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy
          ? "Confirm in your wallet…"
          : quantity > 1
            ? `⛓ Mint this recruit · ${nextCopy} of ${quantity}`
            : "⛓ Mint this recruit"}
      </button>
      <p className="mt-1 text-center text-[10px] leading-snug text-zinc-600">
        Optional. Turns {cardName} into an NFT you own outright and can trade — you pay the gas.
        {quantity > 1 && ` You have ${quantity} copies; each can be minted once.`}
      </p>
      {error && <div className="mt-1 text-center text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
