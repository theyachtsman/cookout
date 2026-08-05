"use client";

import { useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";
import { DEFAULT_CHAIN_ID, setCookoutSigner } from "../lib/cookoutWallet";

/**
 * Publishes the Privy embedded wallet to `lib/cookoutWallet` so the non-React
 * transaction code can sign with it.
 *
 * The embedded wallet is the Cookout Wallet, but it only exists inside React
 * (Privy hands it out through a hook). Everything that actually sends a
 * transaction — chainTx, the wallet page's send form — is plain functions, so
 * this component is the one place the two meet. It also pins the wallet to the
 * play chain, since a freshly created embedded wallet defaults to mainnet and
 * would otherwise sign for the wrong network.
 */
export function CookoutWalletBridge() {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    if (!embedded) {
      setCookoutSigner(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        // Best-effort: if the chain is already right this is a no-op, and a
        // failure here shouldn't stop us publishing a usable signer.
        await embedded.switchChain(DEFAULT_CHAIN_ID).catch(() => {});
        const provider = await embedded.getEthereumProvider();
        if (alive) setCookoutSigner({ provider, address: embedded.address });
      } catch {
        if (alive) setCookoutSigner(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [embedded]);

  return null;
}
