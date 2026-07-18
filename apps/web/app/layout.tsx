import type { Metadata } from "next";
import { SessionProvider } from "../lib/session";
import { DevBanner } from "../components/DevBanner";
import { BetaGate } from "../components/BetaGate";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { TopNav } from "../components/TopNav";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thecookout.fun";
const TITLE = "The Cookout — Live Trading Arena";
const DESCRIPTION =
  "A live multiplayer trading arena: fair-open PvP token rounds, XP quests, and a weekly ETH jackpot. Paper-money beta — get whitelisted on X @hoodcookout.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "The Cookout",
  // opengraph-image.tsx / twitter-image.tsx supply the card image automatically.
  openGraph: {
    type: "website",
    siteName: "The Cookout",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    site: "@hoodcookout",
    creator: "@hoodcookout",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <DevBanner />
        <SessionProvider>
          <TopNav />
          <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4">
            <BetaGate>{children}</BetaGate>
          </main>
          <FeedbackWidget />
        </SessionProvider>
      </body>
    </html>
  );
}
