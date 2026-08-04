import type { Metadata } from "next";
import { SessionProvider } from "../lib/session";
import { SocialProvider } from "../lib/social";
import { SocialDock } from "../components/SocialDock";
import { UserCardProvider } from "../components/UserCard";
import { DevBanner } from "../components/DevBanner";
import { UnlockToasts } from "../components/UnlockToasts";
import { XpOverlay } from "../components/XpOverlay";
import { BurgerOverlay } from "../components/BurgerOverlay";
import { BetaGate } from "../components/BetaGate";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { PresentationProvider } from "../components/Presentation";
import { Providers } from "../components/Providers";
import { SiteFooter } from "../components/SiteFooter";
import { TopNav } from "../components/TopNav";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.thecookout.fun";
const TITLE = "The Cookout · Live Multiplayer Trading";
const DESCRIPTION =
  "A live multiplayer PvP trading game: fair-open token rounds, XP quests, and a weekly ETH jackpot. Open beta, play instantly with paper money. No wallet, no deposit.";

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
        {/* Privy wraps auth; SessionProvider bridges it to our session. */}
        {/* Command Center branding, seasonal theme and editable site copy. */}
        <PresentationProvider>
        <Providers>
          <SessionProvider>
            {/* The persistent social layer wraps the whole app: one always-on
                connection to The Cookout, and a player card reachable from any
                username on any page. */}
            <SocialProvider>
              <UserCardProvider>
                <TopNav />
                {/* pb clears the fixed social dock so it never covers page content;
                    overflow-x-clip is a mobile safety net against any stray wide child */}
                <main className="mx-auto max-w-6xl overflow-x-clip px-3 pb-24 pt-6 sm:px-4">
                  <BetaGate>{children}</BetaGate>
                  <SiteFooter />
                </main>
                <SocialDock />
                <UnlockToasts />
                <XpOverlay />
                <BurgerOverlay />
                <FeedbackWidget />
              </UserCardProvider>
            </SocialProvider>
          </SessionProvider>
        </Providers>
        </PresentationProvider>
      </body>
    </html>
  );
}
