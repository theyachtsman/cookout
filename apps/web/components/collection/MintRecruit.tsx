"use client";

import { useState } from "react";
import { encodeFunctionData } from "viem";
import { api } from "../../lib/api";
import { cookoutSend, logWalletTx, signerReady } from "../../lib/cookoutWallet";

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
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

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
      logWalletTx({
        hash,
        kind: "claim",
        eth: 0,
        via: "cookout",
        chainId: v.chainId,
        at: Date.now(),
        to: v.contract,
      });
      setDone(hash);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Nothing to offer until the wallet is ready — a button that can only fail
  // is worse than no button.
  if (!signerReady()) return null;

  if (done)
    return (
      <div className="rounded-xl bg-lime-400/10 p-2.5 text-center text-xs font-bold text-lime-300 ring-1 ring-lime-400/30">
        Minted — it&apos;s in your wallet.
      </div>
    );

  return (
    <div>
      <button
        disabled={busy}
        onClick={() => void mint(1)}
        className="w-full rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-black text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Confirm in your wallet…" : "⛓ Mint this recruit"}
      </button>
      <p className="mt-1 text-center text-[10px] leading-snug text-zinc-600">
        Optional. Turns {cardName} into an NFT you own outright and can trade — you pay the gas.
        {quantity > 1 && ` You have ${quantity} copies; each can be minted once.`}
      </p>
      {error && <div className="mt-1 text-center text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
