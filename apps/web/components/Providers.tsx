"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { CookoutWalletBridge } from "./CookoutWalletBridge";
import { SpendGuard } from "./SpendGuard";
import { chainOf, DEFAULT_CHAIN_ID } from "../lib/cookoutWallet";

/**
 * Wraps the app in Privy so login (email / social / wallet) is available
 * everywhere. Login methods are configured in the Privy dashboard; here we just
 * ask Privy to give every account an embedded EVM wallet — that address is the
 * player's identity (see session.tsx / server privy.ts).
 *
 * If NEXT_PUBLIC_PRIVY_APP_ID isn't set (local dev without Privy, or a build
 * before the env is wired), we render children without the provider so nothing
 * crashes — auth is simply unavailable until the id is present.
 */
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#a3e635",
          logo: "/brand/mascot.png",
          // We're an EVM-only app, so only surface Ethereum wallets in the connect
          // list. `detected_ethereum_wallets` (not the deprecated `detected_wallets`)
          // is the important bit: it keeps Solana-only wallets like Solflare — and
          // Phantom's Solana side — out of the list. Those have no EVM connector to
          // talk to, so clicking them used to dead-end at the wallet's Chrome Web
          // Store install page. Email / social login (and the embedded EVM wallet
          // every account gets) is the primary way in.
          walletList: [
            "detected_ethereum_wallets",
            "metamask",
            "coinbase_wallet",
            "wallet_connect",
            "rainbow",
          ],
        },
        // The embedded wallet IS the Cookout Wallet, so the app has to be able to
        // sign for the play chain. Privy only signs for chains it knows about,
        // and a new embedded wallet otherwise defaults to Ethereum mainnet.
        defaultChain: chainOf(DEFAULT_CHAIN_ID),
        supportedChains: [chainOf(DEFAULT_CHAIN_ID)],
        // v3 nests wallet creation per-chain; give every login an EVM embedded wallet.
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          // No confirmation sheet per transaction. This is the whole reason the
          // old browser-burner existed: a round is dozens of trades and a modal
          // on each one makes the game unplayable. Money only ever leaves the
          // wallet through our own UI, which confirms before it calls.
          showWalletUIs: false,
        },
      }}
    >
      <CookoutWalletBridge />
      <SpendGuard />
      {children}
    </PrivyProvider>
  );
}
