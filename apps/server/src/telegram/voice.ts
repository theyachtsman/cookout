/**
 * The Pit Boss speaks. Every string the bot sends is minted here so the voice
 * stays consistent: the AI host of The Cookout, all BBQ, never robotic. Pull
 * up. Fresh serving on the grill. Somebody cooked. That coin got burnt. See you
 * at The Cookout.
 *
 * Copy is HTML (Telegram parse_mode=HTML), so anything player-supplied — names,
 * tickers — must pass through esc() before it's interpolated.
 */

/** Escape the three characters that matter for Telegram HTML. */
export function esc(s: string | undefined | null): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const b = (s: string) => `<b>${s}</b>`;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/** A short sign-off dropped on some messages for flavour. */
export function signoff(): string {
  return pick([
    "See you at The Cookout.",
    "Pull up.",
    "Grill's hot.",
    "Come get a plate.",
  ]);
}

// ---- personal milestones (DMs) --------------------------------------------

export const say = {
  linked: (name: string) =>
    `🔥 You're linked, ${b(esc(name))}. I'm the Pit Boss, and I'll holler when something's cooking. ` +
    `Tune what I ping you about in your profile. ${signoff()}`,

  levelUp: (level: number, title: string) =>
    `${pick(["📈", "🔥", "🍖"])} You leveled up to ${b("Level " + level)}, ${b(esc(title))}. Keep cooking.`,

  title: (title: string) => `🎖️ New title unlocked: ${b(esc(title))}. Wear it proud.`,

  achievement: (text: string) => `🏅 ${b("Achievement")}. You ${esc(text)}. That's a plate.`,

  quest: (text: string) => `✅ Quest done: ${esc(text)}. Fresh XP on the grill.`,

  streak: (days: number) => `🔥 ${b(days + "-day streak")}. You keep showing up, I keep the grill lit.`,

  leaderUp: (rank: number) => `🚀 You climbed to ${b("#" + rank)} on the board. Somebody's cooking.`,
  leaderDown: (rank: number) => `📉 You slipped to ${b("#" + rank)}. Time to pull up and cook.`,

  reputationUp: (rep: number) => `📈 Creator reputation up to ${b(String(rep))}. Clean cooking pays.`,
  reputationDown: (rep: number) => `⚠️ Creator reputation down to ${b(String(rep))}. Careful at the grill.`,

  launchBan: (until?: string) =>
    `🚫 You're benched from launching${until ? ` until ${b(esc(until))}` : ""}. ` +
    `Burning your own bag has a cost. Clear it and get back to cooking.`,
  launchBanLifted: () => `✅ Your launch ban lifted. The grill's yours again, so cook clean this time.`,

  followed: (who: string, what: string) => `👀 ${b(esc(who))} ${esc(what)}.`,
};

// ---- community feed (channel / group) -------------------------------------

/** A game-mode line, its own paragraph at the foot of a post. Empty for legacy
 *  coins that predate modes. `mode` is a display name (e.g. "Blitz"). */
const modeTag = (mode?: string) => (mode ? `\n\n🎮 Game mode: ${b(esc(mode))}` : "");

/** The coin's headline: the full name plus its ticker, so posts read as a coin,
 *  not just a symbol. Falls back to the ticker alone when no name is known. */
const coinLabel = (symbol: string, name?: string) =>
  name ? `${b(esc(name))} ($${esc(symbol)})` : `$${esc(symbol)}`;

export const feed = {
  submitted: (symbol: string, name: string, by: string, mode?: string) =>
    `🍳 ${b("Fresh coin on the board")}: ${coinLabel(symbol, name)} by ${esc(by)}.\n\n` +
    `Get it to the vote bar and it hits the grill.${modeTag(mode)}`,

  /** The shill-pit post: a new submission, with a call to rally votes. */
  voteShill: (symbol: string, name?: string, by?: string, mode?: string) =>
    `🍳 ${b("Fresh coin up for a vote")}: ${coinLabel(symbol, name)}${by ? ` by ${esc(by)}` : ""}.\n\n` +
    `This is the shill pit. Make your case, rally the crowd, and get it voted onto the grill.\n\n` +
    `Hit ${b("Shill on X")} to drop it on your timeline. 🔥${modeTag(mode)}`,

  /** The shill-pit post for a Run It Back: the coin's back up for another vote. */
  voteShillRerun: (symbol: string, name?: string, by?: string, mode?: string) =>
    `🔁 ${b("Running it back")}: ${coinLabel(symbol, name)}${by ? ` by ${esc(by)}` : ""} is back up for a vote.\n\n` +
    `It didn't graduate last time, so it's earning its spot again. Rally the crowd and get it ` +
    `voted back onto the grill.\n\n` +
    `Hit ${b("Shill on X")} to drop it on your timeline. 🔥${modeTag(mode)}`,

  votesHit: (symbol: string, name: string | undefined, votes: number, mode?: string) =>
    `🗳️ ${coinLabel(symbol, name)} just hit ${b(votes + " votes")}.\n\n` +
    `It's booked for The Cookout.${modeTag(mode)}`,

  scheduled: (symbol: string, name?: string, mode?: string) =>
    `📅 ${coinLabel(symbol, name)} is on the calendar.\n\n` +
    `${b("Get your people gathered")} before the Pull Up.${modeTag(mode)}`,

  fairOpen: (symbol: string, name?: string, mode?: string) =>
    `⚖️ ${b("It's time to pull up")}. The ${b("Fair Open")} for ${coinLabel(symbol, name)} is here.\n\n` +
    `One price, no snipers, no front-runs. Get your buy in before the bell.${modeTag(mode)}`,

  live: (symbol: string, name?: string, mode?: string) =>
    `🔥 ${coinLabel(symbol, name)} is ${b("LIVE")}.\n\n` +
    `Fresh serving on the grill, get in.${modeTag(mode)}`,

  graduated: (symbol: string, name?: string) =>
    `🍽️ ${b("SOMEBODY COOKED")}.\n\n` +
    `${coinLabel(symbol, name)} served up and walked out into the wild. Legendary.`,

  burnt: (symbol: string, name?: string, mode?: string) =>
    `💀 ${coinLabel(symbol, name)} got burnt.\n\n` +
    `Rug pulled, grill's cold. Onto the next.${modeTag(mode)}`,

  /** The round-end scoreboard: outcome, the top 5 by XP earned, headline stats. */
  roundResults: (o: {
    symbol: string;
    name?: string;
    mode?: string;
    emoji: string;
    outcome: string;
    volume: number;
    peakMcapUsd: number;
    durationSec: number;
    holders: number;
    top: Array<{ name: string; xp: number }>;
  }) => {
    const medal = ["🥇", "🥈", "🥉"];
    const rows = o.top.length
      ? o.top
          .map((t, i) => `${medal[i] ?? `${i + 1}.`} ${b(esc(t.name))}  ${t.xp} XP`)
          .join("\n")
      : "<i>no traders this round</i>";
    const mins = Math.floor(o.durationSec / 60);
    const secs = o.durationSec % 60;
    return (
      `🏁 ${b("Round Results")} · ${coinLabel(o.symbol, o.name)}\n` +
      `${o.emoji} ${b(o.outcome)}\n\n` +
      `${b("🏆 Top 5 by XP")}\n${rows}\n\n` +
      `📊 ${o.volume.toFixed(2)} pETH volume · peak $${o.peakMcapUsd.toLocaleString()} mcap · ` +
      `${o.holders} holder${o.holders === 1 ? "" : "s"} · ${mins}m ${secs}s${modeTag(o.mode)}`
    );
  },

  runItBack: (symbol: string, name?: string, mode?: string) =>
    `🔁 ${coinLabel(symbol, name)} is running it back.\n\n` +
    `Fresh shot, second serving coming up.${modeTag(mode)}`,

  jackpot: (eth: number, usd?: number) =>
    `💰 The ${b("weekly jackpot")} is up to ${b(eth.toFixed(2) + " pETH")}` +
    `${usd ? ` (≈ $${Math.round(usd).toLocaleString()})` : ""}. Climb the board, get a cut.`,

  jackpotPaid: (eth: number, winners: number) =>
    `🏆 ${b("Jackpot paid")}: ${b(eth.toFixed(2) + " pETH")} split across ${winners} cook${winners === 1 ? "" : "s"}. New pot's already heating up.`,

  levelUp: (who: string, level: number, title: string) =>
    `📈 ${esc(who)} hit ${b("Level " + level)}, ${esc(title)}.`,

  achievement: (who: string, text: string) => `🏅 ${esc(who)} ${esc(text)}.`,

  patchNotes: (text: string) => `🛠️ ${b("Patch notes")}\n${esc(text)}`,
  announce: (text: string) => `📣 ${esc(text)}`,
};

// ---- welcome / goodbye -----------------------------------------------------

export const gate = {
  // `mention` is pre-built safe HTML (a tg://user link), so it isn't re-escaped.
  welcome: (mention: string) =>
    `🔥 Pull up, ${b(mention)}. Welcome to ${b("The Cookout")}.\n\n` +
    `This is the live trading pit: real coins, real crowds, one fair price on every open. ` +
    `Grab a plate. Launch a coin, vote on what cooks next, or jump into a live round. ` +
    `What are you cooking first?`,
  goodbye: (name: string) => `👋 ${esc(name)} stepped off the pit. Grill stays hot. ${signoff()}`,
};

// ---- pinned messages (posted + pinned by an admin action) ------------------

export function pins(webBase: string) {
  const u = (p: string) => webBase.replace(/\/$/, "") + p;
  return {
    welcome:
      `🔥 <b>Welcome to The Cookout</b>\n\n` +
      `The live multiplayer trading pit. Every match is a brand-new coin, opened through a fair ` +
      `batch auction (one price, no snipers), traded live in front of the crowd, then it graduates, ` +
      `times out, or gets burnt.\n\n` +
      `<b>The pit, by topic:</b>\n` +
      `📣 Announcements · 💬 General · 💡 Feedback &amp; Ideas · 🍳 Launch a Coin · 📈 Trading &amp; ` +
      `Strategy · 🏆 Leaderboards &amp; Wins · 🆘 Support\n\n` +
      `New here? Hit <b>Play Now</b> and pull up. 🍖`,
    links:
      `🔗 <b>Useful Links</b>\n\n` +
      `🎮 Play: ${u("/")}\n` +
      `📖 How it works: ${u("/docs")}\n` +
      `🍳 Launch a Coin: ${u("/submissions")}\n` +
      `🗳️ Vote: ${u("/vote")}\n` +
      `🔥 The Cook Out: ${u("/matches")}\n` +
      `🏆 Leaderboard: ${u("/leaderboard")}\n` +
      `💰 Jackpot: ${u("/jackpot")}`,
    founders:
      `🥇 <b>Founding Members</b>\n\n` +
      `The first crew at the pit get a <b>permanent Founding Member number</b>. It's capped, never ` +
      `reused, and shown on your profile forever. Claim yours from your profile on the website, then ` +
      `link Telegram so the Pit Boss knows who you are. Early is earned.`,
  };
}

// ---- conversation seeding --------------------------------------------------

export const seeds: string[] = [
  "Question for the pit: what's the best ticker you've seen launch here? 🔥",
  "Moon or rug? What's your read on the next coin up? 🌕🧨",
  "What's your go-to Pull Up size, and why? Talk strategy. 🍖",
  "Who's climbing the board this week? Drop your handle. 🏆",
  "New here? Ask anything. The Pit Boss doesn't bite (much).",
  "What coin do you wish someone would launch? Someone might. 🍳",
];

export function seedPrompt(): string {
  return pick(seeds);
}
