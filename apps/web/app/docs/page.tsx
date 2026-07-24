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
  ["account", "Getting In & Your Account"],
  ["round", "Anatomy of a Round"],
  ["auction", "The Fair Open"],
  ["trading", "Live Trading"],
  ["endings", "Rugs, Redemption & Graduation"],
  ["reputation", "Reputation & Rug Bans"],
  ["tiers", "Risk Tiers"],
  ["progression", "XP, Levels & Titles"],
  ["jackpot", "The Weekly Jackpot"],
  ["quests", "Quests & Earning XP"],
  ["badges", "Badges & Achievements"],
  ["grill", "The Grill (Chat)"],
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
            The Cookout is a <b>live multiplayer trading arena</b>. Every match in the Arena is a
            brand-new token created for that match by a community creator. It opens through a fair
            batch auction, trades live for a few minutes in front of a crowd, then ends one of three
            ways: graduation, timer, or a rug.
          </p>
          <p>
            It is <b>not</b> a simulated casino chart. Every candle you see is made of real trades
            by real players against a real market. During the paper beta all balances are simulated
            (pETH), so the competition is real and the risk is zero.
          </p>
          <p>
            Getting in takes under a minute: sign in with an email, Google, X, or your own wallet
            and you&apos;re in the Arena. No whitelist, nothing to deposit. The beta is free to
            play. <a href="#account" className="text-lime-400 underline">How accounts work →</a>
          </p>
        </Section>

        <Section id="account" title="Getting In & Your Account">
          <p>
            The Cookout is in <b>open beta</b>: no whitelist, no waves, no crypto knowledge
            required. Hit <b>Play Now</b> and sign in with an email, Google, X, or an existing
            wallet (login is handled by{" "}
            <a href="https://privy.io" target="_blank" rel="noreferrer" className="text-lime-400 underline">
              Privy
            </a>
            ). That&apos;s the whole onboarding.
          </p>
          <p>
            Every account comes with its own <b>wallet address</b> under the hood, created
            automatically and secured by your login. That address is your identity: your XP, level,
            match history, and leaderboard runs all hang off it. You never sign transactions or
            manage keys to play; the blockchain stays in the background.
          </p>
          <p>
            Your money lives in your <b>⚡ Arena Account</b> (in the profile menu):
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Arena balance</b>: the stake matches can spend. Your starter 10 pETH is staked
              here automatically on sign-up so you can walk straight into a lobby.
            </li>
            <li>
              <b>Bank</b>: the rest of your paper money. Safe, can&apos;t trade. Move funds
              between bank and arena any time you&apos;re not queued into a match.
            </li>
            <li>
              <b>Your wallet</b>: the real on-chain address behind your login, shown with its live
              balance. Real deposits, withdrawals, and funding the arena with real ETH open at
              mainnet; during the beta everything you play with is pETH.
            </li>
          </ul>
          <p className="text-zinc-400">
            During the beta, matches are kept busy by our <b>Swarm</b>: house traders that behave
            differently every round, so there&apos;s always a market to out-trade. As real players
            fill the lobbies, they take the Swarm&apos;s seats.
          </p>
        </Section>

        <Section id="round" title="Anatomy of a Round">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <b>Scheduled</b>: the match is booked into the Arena. You see the theme; the token stays a
              teaser until the lobby opens.
            </li>
            <li>
              <b>Lobby</b>: token revealed. Check the tokenomics panel, the crowd size, and make
              your Moon-or-Rug call.
            </li>
            <li>
              <b>Queue open</b>: submit buy intents into the batch auction. The live bid board
              shows everyone entering with you.
            </li>
            <li>
              <b>Settling</b>: the queue closes at a fixed time and every fill settles at one
              clearing price, in one shot.
            </li>
            <li>
              <b>Live</b>: continuous trading until the round ends. Watch the graduation bars and
              the kill feed.
            </li>
            <li>
              <b>Results</b>: winners, superlatives, XP, achievements, leaderboard moves.
            </li>
          </ol>
        </Section>

        <Section id="auction" title="The Fair Open">
          <p>
            On every other launchpad, the open is won by whoever has the fastest bot. Here,{" "}
            <b>speed buys nothing</b>:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Buy intents queue until a fixed close time. Arrival order is irrelevant.</li>
            <li>
              Everyone settles at <b>one uniform clearing price</b>: first bid and last bid pay
              exactly the same.
            </li>
            <li>
              If the round is oversubscribed, every intent is filled <b>pro-rata</b>: never by
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
            the only thing the house ever earns. Player losses always go to other players, never
            to us.
          </p>
        </Section>

        <Section id="endings" title="Rugs, Redemption & Graduation">
          <p>A round ends the moment any of these fire:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>🎓 Graduation</b>: market cap, volume, and holder targets all met (watch the
              bonding bars above the chart). The token becomes an <b>Arena Alumni</b>; holders keep
              their position.
            </li>
            <li>
              <b>⏱ Timer / low volume</b>: the round hits its max length or goes quiet. Every
              remaining holder exits automatically at <b>one uniform redemption price</b>: the
              same rate for everyone, no exit-order games, always liquid.
            </li>
            <li>
              <b>🔥 Rug</b>: the pool drains hard or the developer dumps. The kill feed calls it{" "}
              <b>Burnt</b>. Rugging tanks the creator&apos;s reputation and earns their wallet a{" "}
              <b>launch ban</b> (see <a href="#reputation" className="text-lime-400 underline">Reputation
              &amp; Rug Bans</a>). Note: creator sells are time-locked after the open on lower tiers.
              Check the round&apos;s tokenomics panel.
            </li>
          </ul>
          <p className="text-zinc-400">
            Rounds last minutes, exposure is capped on lower tiers, and there is no such thing as
            being stuck holding an unsellable token here.
          </p>
        </Section>

        <Section id="reputation" title="Reputation & Rug Bans">
          <p>
            Every creator carries a public <b>reputation score</b>: it&apos;s on your profile, your
            public profile, and your creator page for anyone to check before they vote your coin up.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ["+2", "Coin graduates", "text-emerald-300"],
              ["+1", "Any clean launch", "text-lime-300"],
              ["−5 + ban", "Your coin rugs", "text-red-300"],
            ].map(([pts, label, tone]) => (
              <div key={label as string} className="rounded-xl border border-zinc-800 p-3">
                <div className={`font-mono text-lg font-black ${tone}`}>{pts}</div>
                <div className="text-xs text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
          <p>
            When a coin you launched rugs, your wallet earns a <b>launch ban</b>. A ban blocks one
            thing only: <b>putting new coins on the ballot</b>. You can still trade every match,
            chat in <a href="#grill" className="text-lime-400 underline">The Grill</a>, earn XP, and
            climb the leaderboard exactly as before. Banned players just wear a{" "}
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-black uppercase text-red-300">
              🚫 banned
            </span>{" "}
            badge on their name in chat until the ban lifts.
          </p>
          <p>
            How you clear a ban depends on the phase you&apos;re playing in. Your{" "}
            <Link href="/profile" className="text-lime-400 underline">Profile</Link> always shows
            which applies to you, in the <b>Reputation</b> panel:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Paper beta: self-serve.</b> A rug ban is a lesson, not a sentence. Open your
              Reputation panel and hit <b>Clear my ban</b> to lift it yourself and get back to
              launching. The rug still stays on your record forever. Reputation remembers, even
              after the ban is gone.
            </li>
            <li>
              <b>Real-money phases: wait it out.</b> Bans lift themselves on a timer, and repeat
              rugs wait longer each time. Your Reputation panel shows a live countdown to when
              you&apos;re clear.
            </li>
          </ul>
          <p className="text-zinc-400">
            Either way, the whole history lives on your creator page: every launch, every
            graduation, and every rug. Reputation is the point. It&apos;s what tells the crowd
            whether your next coin is worth a vote.
          </p>
        </Section>

        <Section id="tiers" title="Risk Tiers">
          <div className="overflow-x-auto">
            <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
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
            </table></div>
          </div>
          <p className="text-zinc-400">
            Deep liquidity means gentle moves; thin liquidity means violence. Degen Arena is earned,
            not given.
          </p>
        </Section>

        <Section id="progression" title="XP, Levels & Titles">
          <p>
            You earn XP every round <b>regardless of profit</b>: participation, first buys,
            diamond hands, perfect exits, rug survival, and more. Every point counts toward your{" "}
            <b>level for life</b>. Levels never reset. Each bracket carries a <b>title</b> that
            rides next to your name everywhere, and two brackets also <b>unlock a new arena</b>. The
            curve steepens as you climb (XP to reach a level ≈{" "}
            <span className="font-mono text-zinc-300">80·(L−1)^1.6</span>).
          </p>

          <div className="overflow-x-auto">
            <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
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
            </table></div>
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
            <b className="text-amber-300">Weekly Jackpot</b>: a shared prize pot that pays out to
            the top players every week.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Trading fills it.</b> {Math.round(JACKPOT_FEE_SHARE * 100)}% of every trading fee
              across the whole site flows into the pot (half of the platform&apos;s house cut).
              Nothing is minted for it. It&apos;s pure fee revenue, so a busy week directly means a
              bigger jackpot. There is no cap.
            </li>
            <li>
              <b>XP wins it.</b> When the week closes (Monday 00:00 UTC), the{" "}
              <b>top {JACKPOT_WINNERS} players by XP earned that week</b> split the pot. It rewards
              playing, not just profit, and it resets every week, so newcomers and veterans compete
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
            </Link>
            .
          </p>
        </Section>

        <Section id="quests" title="Quests & Earning XP">
          <p>
            XP is the whole game. It sets your level, unlocks tiers and cosmetics, and decides
            the <Link href="/jackpot" className="text-amber-400 underline">Weekly Jackpot</Link>.
            You earn it from many places, and the way to the top of the board is always{" "}
            <b>playing well and often</b>, never spamming one action. Every source:
          </p>

          <div className="overflow-x-auto">
            <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
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
                    Buys and sells both earn, but on a decaying curve, capped at{" "}
                    {TRADE_XP.roundCap} XP a round and {TRADE_XP.dailyCap} a day. Wash-spamming
                    trades earns almost nothing.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Daily Quests</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–60</td>
                  <td className="py-2 text-zinc-400">
                    A board of 4 quests that <b>rotates every day</b> from a big pool: play rounds,
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
                    Finish a round top-3 by PnL. Only three players win it per round, so you
                    can&apos;t farm it. You have to out-trade the table.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Achievements</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">
                    {ACHIEVEMENT_XP.common}–{ACHIEVEMENT_XP.legendary}
                  </td>
                  <td className="py-2 text-zinc-400">
                    Every badge you unlock pays one-time XP, scaled by rarity, common to legendary.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Round play</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–75</td>
                  <td className="py-2 text-zinc-400">
                    Just showing up and playing, first buys, profitable finishes, diamond hands,
                    perfect exits, whale hunts, rug survival. All pay, win or lose.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Predictions</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">15–20</td>
                  <td className="py-2 text-zinc-400">
                    <b>Moon or Rug</b>: call each open before it happens. XP only. Bragging rights,
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
                    Play at least one round a day to build a 🔥 <b>play streak</b>: milestones at
                    days 3, 7, 14, 30 pay more and more. Miss a day and a <b>freeze token</b> (earned
                    every 7 days) saves it. Clearing the weekly set week after week builds a second
                    streak.
                  </td>
                </tr>
                <tr className="border-t border-zinc-800">
                  <td className="py-2 pr-4 font-bold">Milestones</td>
                  <td className="py-2 pr-4 font-mono text-lime-300">40–350</td>
                  <td className="py-2 text-zinc-400">
                    Lifetime ladders ({MILESTONES.map((m) => m.name).join(", ")}) that pay XP at
                    every tier as your career totals climb. Months of goals that never reset.
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
            </table></div>
          </div>

          <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Daily quests · {DAILY_ACTIVE_COUNT} of these {MISSIONS.filter((m) => m.period === "daily").length} rotate in each day
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
            Weekly challenges · all {WEEKLY_MISSIONS.length} live all week
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
            Streaks · show up, get paid
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
                <b className="text-sky-300">streak freeze</b> auto-saves one missed day. Earn one
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
            Lifetime milestone ladders · never reset
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
            Monthly season pass · free track
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
            Your season XP climbs a free monthly track, with no paid tier, ever. Hit the marks for
            XP kickers and pass-exclusive cosmetics, then it resets for a fresh climb.
          </p>

          <p className="mt-6 text-zinc-400">
            Track all of it (quests, streaks, milestones, and your pass) on your{" "}
            <Link href="/profile" className="text-lime-400 underline">profile</Link>.
          </p>
          <p className="text-zinc-400">
            <b className="text-zinc-200">One anti-farm rule worth knowing.</b> The “grind” sources
            (trade XP, daily quests, and just showing up) are capped at{" "}
            <span className="font-mono text-zinc-200">{FLOOR_XP_WEEKLY_CAP.toLocaleString()}</span>{" "}
            XP a week toward the jackpot. Past that, only skill, competition, streaks, and milestones
            keep counting. You can&apos;t out-grind the board, you have to out-play it, which is
            exactly why the <Link href="/jackpot" className="text-amber-400 underline">jackpot</Link>{" "}
            stays fair when it&apos;s paying real ETH.
          </p>
        </Section>

        <Section id="badges" title="Badges & Achievements">
          <p>
            Badges are earned <b>once</b> and displayed on your profile forever. Each pays one-time
            XP scaled by rarity: <span className="font-mono text-zinc-400">common {ACHIEVEMENT_XP.common}</span> ·{" "}
            <span className="font-mono text-sky-400">rare {ACHIEVEMENT_XP.rare}</span> ·{" "}
            <span className="font-mono text-violet-400">epic {ACHIEVEMENT_XP.epic}</span> ·{" "}
            <span className="font-mono text-amber-400">legendary {ACHIEVEMENT_XP.legendary}</span>.
            Rarer badges are harder plays. The registry grows over time. Every one live
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

        <Section id="grill" title="The Grill (Chat)">
          <p>
            <b>The Grill</b> is the always-on chat that follows you across the whole site. It never
            logs out and never leaves the screen. It lives in the dock at the{" "}
            <b>bottom-left corner</b>: a small tab when closed (showing who&apos;s online and an
            unread count), the full console when open. Here&apos;s the console, labelled:
          </p>

          <GrillDiagram />

          <p className="mt-4">Three things share the dock, switched by the tabs up top:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>💬 Chat</b>: the conversation. It has <b>channels</b> (see below).
            </li>
            <li>
              <b>Feed</b>: a live ticker of what players are doing right now: pull-ups, wins, rekts,
              graduations, level-ups. Flip it to <b>Following</b> to see only people you follow.
            </li>
            <li>
              <b>People</b>: everyone online, grouped by what they&apos;re doing (trading, in queue,
              spectating, hanging out). Tap a name to open their card and follow them.
            </li>
          </ul>

          <h3 className="mt-6 text-lg font-black text-zinc-100">Channels</h3>
          <p>
            Chat isn&apos;t one firehose. It&apos;s split into channels so the right talk reaches
            the right people, and the dock switches you automatically as you move around the site:
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "🔥 The Grill",
                "The house channel, always there. Site-wide banter plus house announcements: coin launches, match results, and rotating tips.",
              ],
              [
                "🗳️ Vote",
                "Appears when you're on the Vote page. Campaign for your coin and talk shortlists with the people actually voting, without flooding The Grill.",
              ],
              [
                "$SYMBOL",
                "A match's own room, live while you're in that round. This is the trench talk, and it drops back to The Grill when you leave.",
              ],
            ].map(([name, desc]) => (
              <div key={name as string} className="rounded-xl border border-zinc-800 p-3">
                <div className="text-sm font-black text-lime-300">{name}</div>
                <div className="mt-1 text-xs text-zinc-400">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-lg font-black text-zinc-100">Good to know</h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>Newest message sits at the bottom</b> and the log auto-scrolls to it, like every
              chat app you already use.
            </li>
            <li>
              <b>📌 Pinned</b>: a pinned announcement sits above the log and stays put; house tips
              and launch/result banners fade out on their own after 30 seconds so the channel
              doesn&apos;t clog.
            </li>
            <li>
              <b>Emoji &amp; spam bar</b>: the emoji picker drops into your message at the cursor;
              the quick-react bar fires single emoji Twitch-style, one tap each.
            </li>
            <li>
              <b>Your name</b> carries your level and any equipped badge/color. A{" "}
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-black uppercase text-red-300">
                🚫 banned
              </span>{" "}
              tag means that wallet has an active rug ban. They can still chat, they just
              can&apos;t launch coins (see{" "}
              <a href="#reputation" className="text-lime-400 underline">Reputation</a>).
            </li>
            <li>
              Match rooms <b>freeze</b> when the round ends. You can still read the legendary
              moments, but new messages move to The Grill.
            </li>
          </ul>
        </Section>

        <Section id="creators" title="Launching Your Own Coin">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Submit a concept on the <Link href="/submissions" className="text-lime-400 underline">Launchpad</Link>:
              name, symbol, theme, art, your own total supply, a <b>risk tier</b>, and a{" "}
              <b>match length</b> (10, 5, or 1 minute of live trading). Tokens deploy from the
              platform template only. You never supply code, and no mint/pause/blacklist functions
              exist.
            </li>
            <li>
              The community votes. <b>{VOTE_THRESHOLD} upvotes</b> puts your coin straight into the
              Arena at your chosen tier and length; the window closes after 24 hours.
            </li>
            <li>
              Your round runs. You earn <b>{CREATOR_FEE_SHARE * 100}% of the round&apos;s trading
              fees</b>, reputation for clean launches (double for graduations), and a permanent
              &quot;Launched by&quot; credit. Rugging your own round tanks your reputation and{" "}
              <a href="#reputation" className="text-lime-400 underline">bans you from launching</a>{" "}
              until the ban clears.
            </li>
          </ol>

          <h3 className="mt-6 text-lg font-black text-zinc-100">🔁 Run It Back</h3>
          <p>
            A coin that doesn&apos;t graduate isn&apos;t done. Its developer gets a second serving.
            On any of your failed coins you&apos;ll see a <b>Run It Back</b> button: on the coin
            card in the <Link href="/matches" className="text-lime-400 underline">Arena</Link>
            &apos;s Past Results, and on your{" "}
            <Link href="/profile" className="text-lime-400 underline">creator page</Link> launches.
            One click re-launches the coin with the <b>exact same setup</b> (same tier, same match
            length, same tokenomics) straight back into the Arena, no new vote needed.
          </p>
          <p className="text-zinc-400">
            Only the coin&apos;s own developer can run it back. (If you launched under a rug ban,
            you&apos;ll need to clear it first, the same gate as a fresh launch.)
          </p>
        </Section>

        <Section id="faq" title="FAQ">
          <dl className="space-y-4">
            <Faq q="Is this real money?">
              Not in the paper beta. Everyone starts with 10 pETH of simulated balance. The
              format, the market, and the leaderboards are fully real.
            </Faq>
            <Faq q="Can the platform rug me?">
              No. The house has no withdraw rights over round liquidity, every settlement is
              auditable, and our only revenue is the published fee stream. If you lose, a player
              won, not us.
            </Faq>
            <Faq q="What happens to my tokens when a round ends without graduating?">
              Automatic uniform redemption: every remaining holder exits at the same price,
              pro-rata against the pool. You always get out; the only question is the price.
            </Faq>
            <Faq q="My coin rugged or didn't graduate. Can I launch again?">
              A coin that <b>didn&apos;t graduate</b> (timed out or went quiet) can be re-launched
              instantly with <b>Run It Back</b>: same setup, no new vote. A coin that{" "}
              <b>rugged</b> earns your wallet a launch ban first; clear it from the Reputation panel
              on your <a href="#reputation" className="text-lime-400 underline">Profile</a> (or wait
              it out, in real-money phases), then you&apos;re free to launch again.
            </Faq>
            <Faq q="I got a 🚫 banned tag. What can't I do?">
              Just one thing: put new coins on the ballot. You can still trade every match, chat,
              earn XP, and climb the leaderboard. See{" "}
              <a href="#reputation" className="text-lime-400 underline">Reputation &amp; Rug Bans</a>.
            </Faq>
            <Faq q="Why did my limit intent get refunded?">
              The clearing price landed above your max. That&apos;s the limit doing its job: full
              refund, no fill.
            </Faq>
            <Faq q="How do I start playing?">
              Hit <b>Play Now</b> and sign in with an email, Google, X, or your own wallet. Under
              a minute, free, no whitelist, no deposit. Your starter pETH is staked into the arena
              for you, so you can pull up to the next match immediately. Details in{" "}
              <a href="#account" className="text-lime-400 underline">Getting In &amp; Your Account</a>.
            </Faq>
            <Faq q="Do I need a crypto wallet?">
              No. Signing in creates a secure wallet address for you automatically, and that&apos;s
              your account. If you already live on-chain you can connect your own wallet instead.
              Either way, you never sign transactions or touch keys to play.
            </Faq>
            <Faq q="Who am I playing against?">
              Real players, plus our <b>Swarm</b>: house traders that keep every beta match active
              and behave differently each round. They can win or lose just like you. As the
              community grows, real players take their seats. Follow{" "}
              <a href="https://x.com/hoodcookout" target="_blank" rel="noreferrer" className="text-lime-400 underline">@hoodcookout</a>{" "}
              for match events and announcements.
            </Faq>
            <Faq q="How does the Weekly Jackpot work?">
              A slice of every trading fee builds a shared pot that pays the top{" "}
              {JACKPOT_WINNERS} players by weekly XP every Monday, and the more the site trades, the
              bigger it gets. Full details in{" "}
              <a href="#jackpot" className="text-lime-400 underline">The Weekly Jackpot</a> above.
            </Faq>
          </dl>
        </Section>
      </div>
    </div>
  );
}

/**
 * Visual aide for the chat section: a static, labelled replica of the live
 * SocialDock so a reader can map every part of the console to a name before
 * they ever open it. Numbered pins tie the mock to the legend beneath.
 */
function Pin({ n }: { n: number }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lime-400 text-[10px] font-black text-zinc-950">
      {n}
    </span>
  );
}

function GrillDiagram() {
  return (
    <div className="not-prose my-4 grid gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-center">
      {/* the mock console */}
      <div className="overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/50">
        {/* header: channels + tabs */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400" title="connected" />
          <div className="flex min-w-0 items-center gap-1 text-[11px] font-black">
            <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-zinc-100">🔥 The Grill</span>
            <span className="truncate rounded-full px-2 py-0.5 text-lime-300/80">$DOGE</span>
            <Pin n={1} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex overflow-hidden rounded-full bg-zinc-900 p-0.5 text-[11px] font-bold">
              <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-zinc-100">Chat</span>
              <span className="px-2 py-0.5 text-zinc-500">Feed</span>
              <span className="px-2 py-0.5 text-zinc-500">18</span>
            </div>
            <Pin n={2} />
          </div>
        </div>
        {/* pinned bar */}
        <div className="flex items-center gap-1.5 border-b border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-[11px] font-bold text-amber-200">
          📌 New here? Menu → Make a Coin to launch your own.
          <span className="ml-auto"><Pin n={3} /></span>
        </div>
        {/* messages */}
        <div className="space-y-1 px-3 py-2 text-[12px] leading-snug">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[9px] text-zinc-600">7</span>
            <span className="font-bold text-zinc-300">chef_mike</span>
            <span className="text-zinc-300">first pull-up lfg 🔥</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[9px] text-zinc-600">3</span>
            <span className="font-bold text-zinc-300">saucedup</span>
            <span className="rounded bg-red-500/20 px-1 py-px text-[9px] font-black uppercase text-red-300">
              🚫 banned
            </span>
            <span className="text-zinc-300">still here, still trading 😎</span>
            <span className="ml-1"><Pin n={4} /></span>
          </div>
          <div className="rounded bg-amber-400/[0.06] px-1.5 py-1 text-[11px] text-amber-200/90">
            📢 $DOGE just went LIVE, pull up
          </div>
        </div>
        {/* quick emoji + input */}
        <div className="flex items-center gap-1 border-t border-zinc-800 px-2 py-1 text-sm">
          <span>🔥</span><span>🚀</span><span>💀</span><span>😂</span>
          <span className="ml-auto"><Pin n={5} /></span>
        </div>
        <div className="flex items-center gap-1.5 border-t border-zinc-800 p-2">
          <span className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-500">
            say something to the whole cookout…
          </span>
          <span className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950">Send</span>
        </div>
      </div>

      {/* legend */}
      <ol className="space-y-2.5 text-sm text-zinc-300">
        {[
          ["Channels", "The room you're talking in. 🔥 The Grill is always here; a $SYMBOL room shows up while you're in that match."],
          ["Tabs", "Switch between Chat, the live Feed, and People (online count)."],
          ["Pinned", "A house message that stays put above the log."],
          ["Banned tag", "That wallet has an active rug ban. They can chat, not launch."],
          ["Quick reacts", "Tap an emoji to fire it instantly; the picker also drops emoji into your message."],
        ].map(([label, desc], i) => (
          <li key={label} className="flex gap-2.5">
            <Pin n={i + 1} />
            <span>
              <b className="text-zinc-100">{label}.</b> {desc}
            </span>
          </li>
        ))}
      </ol>
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
