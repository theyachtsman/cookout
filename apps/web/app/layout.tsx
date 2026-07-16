import type { Metadata } from "next";
import { SessionProvider } from "../lib/session";
import { BetaGate } from "../components/BetaGate";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { TopNav } from "../components/TopNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Cookout",
  description: "Live multiplayer trading arena and launchpad — Phase 1 paper money",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
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
