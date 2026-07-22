"use client";

import { PrivyProvider } from "@privy-io/react-auth";

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
        appearance: { theme: "dark", accentColor: "#a3e635", logo: "/brand/mascot.png" },
        embeddedWallets: { createOnLogin: "all-users" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
