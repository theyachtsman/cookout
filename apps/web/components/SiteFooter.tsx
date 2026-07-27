import Link from "next/link";

/**
 * Site-wide footer. Primarily a home for the community: a prominent Telegram
 * join call-to-action (the Pit Boss group), the official X account, and the
 * house links. Rendered once from the root layout so every page carries it.
 */

/** The Cookout Telegram group invite (public). */
const TELEGRAM_INVITE = "https://t.me/+lrFJm9wS9-tiOTYx";
const X_URL = "https://x.com/hoodcookout";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-800 pt-8 text-sm">
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        {/* Community — Telegram front and center */}
        <div className="max-w-md">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
            Join the cookout
          </div>
          <p className="mt-2 text-zinc-400">
            The whole crowd hangs in Telegram — live match calls, launches, shilling, and{" "}
            <span className="font-bold text-zinc-200">The Pit Boss</span> keeping the grill hot.
            Pull up.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <a
              href={TELEGRAM_INVITE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 font-black text-zinc-950 transition hover:bg-sky-400"
            >
              <TelegramGlyph /> Join the Telegram group
            </a>
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 font-bold text-zinc-300 transition hover:border-zinc-500"
            >
              𝕏 @hoodcookout
            </a>
          </div>
        </div>

        {/* House links */}
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-zinc-400">
          <Link href="/matches" className="hover:text-lime-300">
            The Cook Out
          </Link>
          <Link href="/vote" className="hover:text-lime-300">
            Vote
          </Link>
          <Link href="/submissions" className="hover:text-lime-300">
            Launch a Coin
          </Link>
          <Link href="/leaderboard" className="hover:text-lime-300">
            Leaderboard
          </Link>
          <Link href="/jackpot" className="hover:text-lime-300">
            Jackpot
          </Link>
          <Link href="/docs" className="hover:text-lime-300">
            The Menu
          </Link>
        </nav>
      </div>

      <div className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-zinc-800/70 py-6 text-xs text-zinc-600 sm:flex-row sm:items-center">
        <span>
          The Cookout · paper-money beta — nothing here is real money yet · we only ever make money
          on fees.
        </span>
        <span>
          {X_URL.replace("https://", "")} is our only official account — we never DM first.
        </span>
      </div>
    </footer>
  );
}

/** A tiny inline Telegram paper-plane so the CTA reads at a glance. */
function TelegramGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.9 4.3c.3-1.2-.9-2.2-2-1.7L2.6 9.7c-1.3.5-1.2 2.4.1 2.8l4.3 1.3 1.6 5.1c.2.7 1.1.9 1.6.3l2.4-2.4 4.4 3.2c.8.6 1.9.1 2.1-.8l3-14.9zM8.6 13.2l8-5c.2-.1.4.2.2.4l-6.6 6.2c-.2.2-.4.5-.4.8l-.2 2.2-1-4.6z" />
    </svg>
  );
}
