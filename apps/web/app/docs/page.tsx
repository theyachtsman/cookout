"use client";

import Link from "next/link";
import {
  LEVEL_TITLES,
  TIER_CONFIGS,
  TIER_UNLOCK_LEVEL,
  VOTE_THRESHOLD,
  CREATOR_FEE_SHARE,
  JACKPOT_FEE_SHARE,
  JACKPOT_WINNERS,
  JACKPOT_PAYOUT_WEIGHTS,
  DAILY_SET_BONUS_XP,
  WEEKLY_SET_BONUS_XP,
  DAILY_ACTIVE_COUNT,
  PODIUM_XP,
  TRADE_XP,
  ACHIEVEMENT_XP,
  ACHIEVEMENTS,
  FLOOR_XP_WEEKLY_CAP,
  DAILY_STREAK_MILESTONES,
  WEEKLY_STREAK_MILESTONES,
  STREAK_FREEZE_MAX,
  SEASON_PASS_TIERS,
  MILESTONES,
  MISSIONS,
  WEEKLY_MISSIONS,
  xpForLevel,
} from "@cookout/shared";

/** Product wiki: everything a new player needs, in the arena's own voice. */

const SECTIONS = [
  ["what", "What is The Cookout?"],
  ["round", "Anatomy of a Round"],
  ["auction", "The Fair Open"],
  ["trading", "Live Trading"],
  ["endings", "Rugs, Redemption & Graduation"],
  ["tiers", "Risk Tiers"],
  ["progression", "XP, Levels & Titles"],
  ["jackpot", "The Weekly Jackpot"],
  ["quests", "Quests & Earning XP"],
  ["badges", "Badges & Achievements"],
  ["creators", "Launching Your Own Coin"],
  ["faq", "FAQ"],
] as const;

export default function Docs() {
  return (
    <div className="mx-auto flex max-w-6xl gap-10">
      <aside className="sticky top-20 hidden h-fit w-52 shrink-0 md:block">
        <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">The Menu</div>
        <nav className="mt-3 space-y-1">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-lime-300"
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-14 pb-24">
        <header>
          <h1 className="text-4xl font-black">
            The Cookout <span className="text-lime-400">Menu</span>
          </h1>
          <p className="mt-2 text-zinc-400">
            Everything you need before you pull up. Five minutes to read; a lifetime to master the
            exit.
          </p>
        </header>

        <Section id="what" title="What is The Cookout?">
          <p>
            The Cookout is a <b>live multiplayer trading arena</b>. Every match on the calendar is a
            brand-new token created for that match by a community creator. It opens through a fair
            batch auction, trades live for a few minutes in front of a crowd, and then ends — by
            graduation, by timer, or by getting rugged.
          </p>
          <p>
            It is <b>not</b> a simulated casino chart. Every candle you see is made of real trades
            by real players against a real market. During the paper beta all balances are simulated
            (pETH), so the competition is real and the risk is zero.
          </p>
          <p>
            Your wallet is your whole identity — no emails, no passwords, no deposits. Signing a
            message proves the wallet is yours; that&apos;s it.
          </p>
        </Section>

        <Section id="round" title="Anatomy of a Round">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <b>Scheduled</b> — the match is on the calendar. You see the theme; the token stays a
              teaser until the lobby opens.
            </li>
            <li>
              <b>Lobby</b> — token revealed. Check the tokenomics panel, the crowd size, and make
              your Moon-or-Rug call.
            </li>
            <li>
              <b>Queue open</b> — submit buy intents into the batch auction. The live bid board
              shows everyone entering with you.
            </li>
            <li>
              <b>Settling</b> — the queue closes at a fixed time and every fill settles at one
              clearing price, in one shot.
            </li>
            <li>
              <b>Live</b> — continuous trading until the round ends. Watch the graduation bars and
              the kill feed.
            </li>
            <li>
              <b>Results</b> — winners, superlatives, XP, achievements, leaderboard moves.
            </li>
          </ol>
        </Section>

        <Section id="auction" title="The Fair Open (read this one)">
          <p>
            On every other launchpad, the open is won by whoever has the fastest bot. Here,{" "}
            <b>speed buys nothing</b>:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Buy intents queue until a fixed close time. Arrival order is irrelevant.</li>
            <li>
              Everyone settles at <b>one uniform clearing price</b> — first bid and last bid pay
              exactly the same.
            </li>
            <li>
              If the round is oversubscribed, every intent is filled <b>pro-rata</b> — never by
              price priority, never first-come-first-served.
            </li>
            <li>
              You can set a max price; if the clearing price lands above it, you&apos;re fully
              refunded.
            </li>
            <li>
              Every settlement publishes an <b>audit hash</b> you can recompute yourself from the
              public intents and our open-source clearing math.
            </li>
          </ul>
        </Section>

        <Section id="trading" title="Live Trading">
          <p>
            Once the auction settles, it&apos;s a real market: your buys push price up, sells push
            it down, 1-second candles, everything visible to the crowd. The chart shows{" "}
            <b>market-cap view</b>. Big buys and sells pop tagged
            bubbles right on the chart. A 🔥 <b>Cooking</b> tag means volume is running hot.
          </p>
          <p>
            Fees are flat and published: <b>{TIER_CONFIGS.rookie.tradeFeeBps / 100}%</b> per trade,{" "}
            <b>{TIER_CONFIGS.rookie.auctionFeeBps / 100}%</b> on auction fills. That fee stream is
            the only thing the house ever earns — player losses always go to other players, never
            to us.
          </p>
        </Section>

        <Section id="endings" title="Rugs, Redemption & Graduation">
          <p>A round ends the moment any of these fire:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>🎓 Graduation</b> — market cap, volume, and holder targets all met (watch the
              bonding bars above the chart). The token becomes an <b>Arena Alumni</b>; holders keep
              their position.
            </li>
            <li>
              <b>⏱ Timer / low volume</b> — the round hits its max length or goes quiet. Every
              remaining holder exits automatically at <b>one uniform redemption price</b> — the
              same rate for everyone, no exit-order games, always liquid.
            </li>
            <li>
              <b>🔥 Rug</b> — the pool drains hard or the developer dumps. The kill feed calls it{" "}
              <b>Burnt</b>. Rugging tanks the creator&apos;s reputation and flags their wallet.
              Note: creator sells are time-locked after the open on lower tiers — check the
              round&apos;s tokenomics panel.
            </li>
          </ul>
          <p className="text-zinc-400">
            Rounds last minutes, exposure is capped on lower tiers, and there is no such thing as
            being stuck holding an unsellable token here.
          </p>
        </Section>

        <Section id="tiers" title="Risk Tiers">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Tier</th>
                  <th className="py-2 pr-4">Unlock</th>
                  <th className="py-2 pr-4">Liquidity</th>
                  <th className="py-2 pr-4">Queue cap</th>
                  <th className="py-2">Dev sell lock</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(["rookie", "standard", "degen"] as const).map((t) => {
                  const c = TIER_CONFIGS[t];
                  return (
                    <tr key={t} className="border-t border-zinc-800">
                      <td className="py-2 pr-4 font-bold uppercase">{t}</td>
                      <td className="py-2 pr-4">Lv {TIER_UNLOCK_LEVEL[t]}</td>
                      <td className="py-2 pr-4">{c.initialEthLiquidity} pETH (deep→thin)</td>
                      <td className="py-2 pr-4">{c.maxPositionEth > 0 ? `${c.maxPositionEth} pETH` : "none"}</td>
                      <td className="py-2">{c.devSellLockSeconds > 0 ? `${c.devSellLockSeconds}s` : "none 💀"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-zinc-400">
            Deep liquidity means gentle moves; thin liquidity means violence. Degen Arena is earned,
            not given.
          </p>
        </Section>

        <Section id="progression" title="XP, Levels & Titles">
          <p>
            You earn XP every round <b>regardless of profit</b> — participation, first buys,
            diamond hands, perfect exits, rug survival, and more. Every point counts toward your{" "}
            <b>level for life</b> — levels never reset. Each bracket carries a <b>title</b> that
            rides next to your name everywhere, and two brackets also <b>unlock a new arena</b>. The
            curve steepens as you climb (XP to reach a level ≈{" "}
            <span className="font-mono text-zinc-300">80·(L−1)^1.6</span>).
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Level</th>
                  <th className="py-2 pr-4">XP to reach</th>
                  <th className="py-2">Unlocks</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {[...LEVEL_TITLES]
                  .sort((a, b) => a.minLevel - b.minLevel)
                  .map((t) => {
                    const unlock = (Object.keys(TIER_UNLOCK_LEVEL) as Array<
                      keyof typeof TIER_UNLOCK_LEVEL
                    >).find((tier) => TIER_UNLOCK_LEVEL[tier] === t.minLevel);
                    return (
                      <tr key={t.minLevel} className="border-t border-zinc-800">
                        <td className="py-2 pr-4 font-bold text-lime-300">{t.title}</td>
                        <td className="py-2 pr-4 font-mono text-zinc-300">{t.minLevel}</td>
                        <td className="py-2 pr-4 font-mono text-amber-300">
                          {t.minLevel <= 1 ? "start" : xpForLevel(t.minLevel).toLocaleString()}
                        </td>
                        <td className="py-2 text-zinc-400">
                          {unlock ? (
                            <span className="capitalize">🔓 {unlock} Arena</span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <p>
            Badges, titles, chat colors, and frames unlock from levels, achievements, season
            placements, and the monthly season pass. Full detail on earning XP is in{" "}
            <a href="#quests" className="text-lime-400 underline">Quests &amp; Earning XP</a>; the
            complete badge list is under{" "}
            <a href="#badges" className="text-lime-400 underline">Badges &amp; Achievements</a>.{" "}
            <b>Everything cosmetic is earned; nothing is for sale that affects play.</b>
          </p>
        </Section>

        <Section id="jackpot" title="The Weekly Jackpot">
          <p>
            Every trade on The Cookout feeds a single, site-wide{" "}
            <b className="text-amber-300">Weekly Jackpot</b> — a shared prize pot that pays out to
            the top players every week.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Trading fills it.</b> {Math.round(JACKPOT_FEE_SHARE * 100)}% of every trading fee
              across the whole site flows into the pot (half of the platform&apos;s house cut).
              Nothing is minted for it — it&apos;s pure fee revenue, so a busy week directly means a
              bigger jackpot. There is no cap.
            </li>
            <li>
              <b>XP wins it.</b> When the week closes (Monday 00:00 UTC), the{" "}
              <b>top {JACKPOT_WINNERS} players by XP earned that week</b> split the pot. It rewards
              playing, not just profit — and it resets every week, so newcomers and veterans compete
              on the same clock.
            </li>
            <li>
              <b>1st, 2nd and 3rd take the most,</b> then the shares taper down through 10th:{" "}
              <span className="font-mono text-amber-300">
                {JACKPOT_PAYOUT_WEIGHTS.map((w) => `${Math.round(w * 100)}%`).join(" · ")}
              </span>
              .
            </li>
            <li>
              <b>Paid automatically.</b> During the paper beta, winnings land in your paper balance
              and show as trophies on your public profile. In production the same payout goes out as
              real ETH to the winning wallet addresses.
            </li>
            <li>
              <b>It only grows.</b> If fewer than {JACKPOT_WINNERS} players earned XP in a week, the
              unclaimed shares roll into next week&apos;s pot.
            </li>
          </ul>
          <p className="text-zinc-400">
            The live pot, this week&apos;s standings, the full fee breakdown, and past payouts are
            all on the{" "}
            <Link href="/jackpot" className="text-amber-400 underline">
              Jackpot page
            </Link>{" "}
            (open once you&apos;re in the beta).
          </p>
        </Section>

        <Section id="quests" title="Quests & Earning XP">
          <p>
            XP is the whole game — it sets your level, unlocks tiers and cosmetics, and decides
            the <Link href="/jackpot" className="text-amber-400 underline">Weekly Jackpot</Link>.
            You earn it from many places, and the system is built so the way to the top of the
            board is <b>playing well and often</b>, never spamming one action. Here&apos;s every
            source:
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">XP</th>
                  <th className="py-2">How it works</th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Every trade</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">5·3·2·1…</td>
                  <td className="py-2 text-zinc-400">
                    Buys and sells both earn, but on a decaying curve — capped at{" "}
                    {TRADE_XP.roundCap} XP a round and {TRADE_XP.dailyCap} a day. Wash-spamming
                    trades earns almost nothing.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Daily Quests</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–60</td>
                  <td className="py-2 text-zinc-400">
                    A board of 4 quests that <b>rotates every day</b> from a big pool — play rounds,
                    catch a dip, nail an exit, hold to the end, make the podium. Clear all four for a{" "}
                    <span className="text-amber-300">+{DAILY_SET_BONUS_XP}</span> bonus.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Weekly Challenges</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">120–250</td>
                  <td className="py-2 text-zinc-400">
                    Bigger goals that span the week and drive your jackpot standing. Clear the whole
                    set for a <span className="text-amber-300">+{WEEKLY_SET_BONUS_XP}</span> bonus.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Round podium</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">
                    {PODIUM_XP.join(" / ")}
                  </td>
                  <td className="py-2 text-zinc-400">
                    Finish a round top-3 by PnL. Only three players win it per round — you can&apos;t
                    farm it, you have to out-trade the table.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Achievements</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">
                    {ACHIEVEMENT_XP.common}–{ACHIEVEMENT_XP.legendary}
                  </td>
                  <td className="py-2 text-zinc-400">
                    Every badge you unlock pays one-time XP, scaled by rarity — common to legendary.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Round play</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–75</td>
                  <td className="py-2 text-zinc-400">
                    Just showing up and playing, first buys, profitable finishes, diamond hands,
                    perfect exits, whale hunts, rug survival — all pay, win or lose.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Predictions</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–20</td>
                  <td className="py-2 text-zinc-400">
                    <b>Moon or Rug</b> — call each open before it happens. XP only; bragging rights,
                    not a bet.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Streaks</td>
                  <td className="py-2 pr-4 font-mono text-orange-300">
                    {Object.values(DAILY_STREAK_MILESTONES)[0]}–
                    {Object.values(DAILY_STREAK_MILESTONES).slice(-1)[0]}+
                  </td>
                  <td className="py-2 text-zinc-400">
                    Play at least one round a day to build a 🔥 <b>play streak</b> — milestones at
                    days 3, 7, 14, 30 pay more and more. Miss a day and a <b>freeze token</b> (earned
                    every 7 days) saves it. Clearing the weekly set week after week builds a second
                    streak.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Milestones</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">40–350</td>
                  <td className="py-2 text-zinc-400">
                    Lifetime ladders — {MILESTONES.map((m) => m.name).join(", ")} — pay XP at every
                    tier as your career totals climb. Months of goals that never reset.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Season Pass</td>
                  <td className="py-2 pr-4 font-mono text-amber-300">
                    {SEASON_PASS_TIERS[0]!.xp}–{SEASON_PASS_TIERS.slice(-1)[0]!.xp}
                  </td>
                  <td className="py-2 text-zinc-400">
                    A free monthly track: pass XP thresholds to earn kickers and unlock
                    pass-exclusive cosmetics. Resets each month for a fresh climb.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Daily quests — {DAILY_ACTIVE_COUNT} of these {MISSIONS.filter((m) => m.period === "daily").length} rotate in each day
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MISSIONS.filter((m) => m.period === "daily").map((m) => (
              <QuestCard key={m.id} name={m.name} desc={m.description} xp={m.xp} />
            ))}
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            The board reseeds every day at 00:00 UTC (always with at least one easy starter). Clear
            all {DAILY_ACTIVE_COUNT} for a <span className="text-amber-300">+{DAILY_SET_BONUS_XP} XP</span> sweep bonus.
          </p>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Weekly challenges — all {WEEKLY_MISSIONS.length} live all week
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WEEKLY_MISSIONS.map((m) => (
              <QuestCard key={m.id} name={m.name} desc={m.description} xp={m.xp} />
            ))}
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            They reset Monday 00:00 UTC with the jackpot week. Clear the whole set for a{" "}
            <span className="text-amber-300">+{WEEKLY_SET_BONUS_XP} XP</span> bonus.
          </p>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Streaks — show up, get paid
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 p-4">
              <div className="mb-2 text-sm font-bold">🔥 Daily play streak</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
                {Object.entries(DAILY_STREAK_MILESTONES).map(([days, xp]) => (
                  <span key={days} className="text-zinc-300">
                    {days}d <span className="text-amber-300">+{xp}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Consecutive days played. Past 30 days, upkeep pays +50 XP each further week. A{" "}
                <b className="text-sky-300">streak freeze</b> auto-saves one missed day — earn one
                every 7 days played, hold up to {STREAK_FREEZE_MAX}.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 p-4">
              <div className="mb-2 text-sm font-bold">📅 Weekly consistency</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
                {Object.entries(WEEKLY_STREAK_MILESTONES).map(([weeks, xp]) => (
                  <span key={weeks} className="text-zinc-300">
                    {weeks}w <span className="text-amber-300">+{xp}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Consecutive weeks clearing the weekly set. Beyond 8 weeks, every 4th week keeps
                paying +900 XP. The single biggest long-term XP source.
              </p>
            </div>
          </div>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Lifetime milestone ladders — never reset
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {MILESTONES.map((lad) => (
              <div key={lad.id} className="rounded-xl border border-zinc-800 p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-bold">{lad.name}</span>
                  <span className="font-mono text-xs text-zinc-500">{lad.unit}</span>
                </div>
                <div className="space-y-1">
                  {lad.tiers.map((tier) => (
                    <div key={tier.at} className="flex justify-between font-mono text-sm">
                      <span className="text-zinc-300">{tier.at.toLocaleString()}</span>
                      <span className="text-amber-300">+{tier.xp}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Monthly season pass — free track
          </h3>
          <div className="overflow-x-auto">
            <div className="flex gap-2">
              {SEASON_PASS_TIERS.map((tier, i) => (
                <div
                  key={tier.at}
                  className={`min-w-[120px] flex-1 rounded-xl border p-3 ${
                    tier.reward ? "border-amber-400/40" : "border-zinc-800"
                  }`}
                >
                  <div className="font-mono text-[10px] uppercase text-zinc-500">Tier {i + 1}</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-zinc-200">
                    {tier.at.toLocaleString()}
                    <span className="ml-1 text-[10px] font-normal text-zinc-500">season XP</span>
                  </div>
                  <div className="mt-1 font-mono text-sm text-amber-300">+{tier.xp}</div>
                  {tier.reward && (
                    <div className="mt-2 border-t border-zinc-800 pt-2 text-xs text-amber-300">
                      {tier.reward}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Your season XP climbs a free monthly track — no paid tier, ever. Hit the marks for XP
            kickers and pass-exclusive cosmetics, then it resets for a fresh climb.
          </p>

          <p className="mt-6 text-zinc-400">
            Track all of it — quests, streaks, milestones and your pass — on your{" "}
            <Link href="/profile" className="text-lime-400 underline">profile</Link>.
          </p>
          <p className="text-zinc-400">
            <b className="text-zinc-200">One anti-farm rule worth knowing:</b> the “grind” sources —
            trade XP, daily quests, and just showing up — are capped at{" "}
            <span className="font-mono text-zinc-200">{FLOOR_XP_WEEKLY_CAP.toLocaleString()}</span>{" "}
            XP a week toward the jackpot. Past that, only skill, competition, streaks, and milestones
            keep counting. You can&apos;t out-grind the board — you have to out-play it, which is
            exactly why the <Link href="/jackpot" className="text-amber-400 underline">jackpot</Link>{" "}
            stays fair when it&apos;s paying real ETH.
          </p>
        </Section>

        <Section id="badges" title="Badges & Achievements">
          <p>
            Badges are earned <b>once</b> and displayed on your profile forever. Each pays one-time
            XP scaled by rarity — <span className="font-mono text-zinc-400">common {ACHIEVEMENT_XP.common}</span> ·{" "}
            <span className="font-mono text-sky-400">rare {ACHIEVEMENT_XP.rare}</span> ·{" "}
            <span className="font-mono text-violet-400">epic {ACHIEVEMENT_XP.epic}</span> ·{" "}
            <span className="font-mono text-amber-400">legendary {ACHIEVEMENT_XP.legendary}</span>.
            Rarer badges are harder plays. The registry grows over time — here&apos;s every one live
            today:
          </p>
          {(["legendary", "epic", "rare", "common"] as const).map((rarity) => {
            const list = ACHIEVEMENTS.filter((a) => a.rarity === rarity);
            if (list.length === 0) return null;
            return (
              <div key={rarity} className="mt-5">
                <div className={`mb-2 text-xs font-bold uppercase tracking-wide ${RARITY_TEXT[rarity]}`}>
                  {rarity} · +{ACHIEVEMENT_XP[rarity]} XP · {list.length}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((a) => (
                    <div
                      key={a.id}
                      className={`rounded-xl border-l-2 border border-zinc-800 p-3 ${RARITY_BORDER[rarity]}`}
                    >
                      <div className="text-sm font-bold text-zinc-100">{a.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{a.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Section>

        <Section id="creators" title="Launching Your Own Coin">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Submit a concept on the <Link href="/submissions" className="text-lime-400 underline">Launchpad</Link>:
              name, symbol, theme, art, and your own total supply. Tokens deploy from the platform
              template only — you never supply code, and no mint/pause/blacklist functions exist.
            </li>
            <li>
              The community votes. <b>{VOTE_THRESHOLD} upvotes</b> auto-shortlists you; the window
              closes after 24 hours.
            </li>
            <li>The committee schedules shortlisted concepts into match slots.</li>
            <li>
              Your round runs. You earn <b>{CREATOR_FEE_SHARE * 100}% of the round&apos;s trading
              fees</b>, reputation for clean launches (double for graduations), and a permanent
              &quot;Launched by&quot; credit. Rugging your own round tanks your reputation and
              flags your wallet.
            </li>
          </ol>
        </Section>

        <Section id="faq" title="FAQ">
          <dl className="space-y-4">
            <Faq q="Is this real money?">
              Not in the paper beta — everyone starts with 10 pETH of simulated balance. The
              format, the market, and the leaderboards are fully real.
            </Faq>
            <Faq q="Can the platform rug me?">
              No. The house has no withdraw rights over round liquidity, every settlement is
              auditable, and our only revenue is the published fee stream. If you lose, a player
              won — not us.
            </Faq>
            <Faq q="What happens to my tokens when a round ends without graduating?">
              Automatic uniform redemption: every remaining holder exits at the same price,
              pro-rata against the pool. You always get out; the only question is the price.
            </Faq>
            <Faq q="Why did my limit intent get refunded?">
              The clearing price landed above your max. That&apos;s the limit doing its job — full
              refund, no fill.
            </Faq>
            <Faq q="How do I get whitelisted for the beta?">
              The whitelist is earned on X. Follow{" "}
              <a href="https://x.com/hoodcookout" target="_blank" rel="noreferrer" className="text-lime-400 underline">@hoodcookout</a>,
              like and repost the posts, and comment your Robinhood wallet address (0x…). Eligible
              wallets are added by hand — watch for the official beta-test announcement to know when
              your wave goes live. Full steps on the{" "}
              <Link href="/#access" className="text-lime-400 underline">home page</Link>.
            </Faq>
            <Faq q="How does the Weekly Jackpot work?">
              A slice of every trading fee builds a shared pot that pays the top{" "}
              {JACKPOT_WINNERS} players by weekly XP every Monday — the more the site trades, the
              bigger it gets. Full details in{" "}
              <a href="#jackpot" className="text-lime-400 underline">The Weekly Jackpot</a> above.
            </Faq>
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-4 border-b border-zinc-800 pb-2 text-2xl font-black">{title}</h2>
      <div className="space-y-3 leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-bold text-zinc-100">{q}</dt>
      <dd className="mt-1 text-sm text-zinc-400">{children}</dd>
    </div>
  );
}

function QuestCard({ name, desc, xp }: { name: string; desc: string; xp: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-zinc-100">{name}</span>
        <span className="font-mono text-sm text-amber-300">+{xp}</span>
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{desc}</div>
    </div>
  );
}

/** Rarity → styling. Conventional game semantics; each badge is always text-labelled. */
const RARITY_TEXT: Record<AchievementRarity, string> = {
  common: "text-zinc-400",
  rare: "text-sky-400",
  epic: "text-violet-400",
  legendary: "text-amber-400",
};
const RARITY_BORDER: Record<AchievementRarity, string> = {
  common: "border-l-zinc-600",
  rare: "border-l-sky-400",
  epic: "border-l-violet-400",
  legendary: "border-l-amber-400",
};
type AchievementRarity = (typeof ACHIEVEMENTS)[number]["rarity"];
