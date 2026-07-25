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
    `🔥 You're linked, ${b(esc(name))}. I'm the Pit Boss — I'll holler when something's cooking. ` +
    `Tune what I ping you about in your profile. ${signoff()}`,

  levelUp: (level: number, title: string) =>
    `${pick(["📈", "🔥", "🍖"])} You leveled up. ${b("Level " + level)} — ${b(esc(title))}. Keep cooking.`,

  title: (title: string) => `🎖️ New title unlocked: ${b(esc(title))}. Wear it proud.`,

  achievement: (text: string) => `🏅 ${b("Achievement")} — you ${esc(text)}. That's a plate.`,

  quest: (text: string) => `✅ Quest done: ${esc(text)}. Fresh XP on the grill.`,

  streak: (days: number) => `🔥 ${b(days + "-day streak")}. You keep showing up, I keep the grill lit.`,

  leaderUp: (rank: number) => `🚀 You climbed to ${b("#" + rank)} on the board. Somebody's cooking.`,
  leaderDown: (rank: number) => `📉 You slipped to ${b("#" + rank)}. Time to pull up and cook.`,

  reputationUp: (rep: number) => `📈 Creator reputation up to ${b(String(rep))}. Clean cooking pays.`,
  reputationDown: (rep: number) => `⚠️ Creator reputation down to ${b(String(rep))}. Careful at the grill.`,

  launchBan: (until?: string) =>
    `🚫 You're benched from launching${until ? ` until ${b(esc(until))}` : ""}. ` +
    `Burning your own bag has a cost. Clear it and get back to cooking.`,
  launchBanLifted: () => `✅ Your launch ban lifted. The grill's yours again — cook clean this time.`,

  followed: (who: string, what: string) => `👀 ${b(esc(who))} ${esc(what)}.`,
};

// ---- community feed (channel / group) -------------------------------------

export const feed = {
  submitted: (symbol: string, name: string, by: string) =>
    `🍳 ${b("Fresh coin on the board")} — $${esc(symbol)} (${esc(name)}) by ${esc(by)}. ` +
    `Get it to the vote bar and it hits the grill.`,

  votesHit: (symbol: string, votes: number) =>
    `🗳️ $${esc(symbol)} just hit ${b(votes + " votes")}. It's booked for The Cookout.`,

  scheduled: (symbol: string) =>
    `📅 $${esc(symbol)} is on the calendar. ${b("Get your people gathered")} before the Pull Up.`,

  fairOpen: (symbol: string) =>
    `⚖️ ${b("Fair Open")} on $${esc(symbol)}. One price, no snipers, no front-runs. Pull up.`,

  live: (symbol: string) => `🔥 $${esc(symbol)} is ${b("LIVE")}. Fresh serving on the grill — get in.`,

  graduated: (symbol: string) =>
    `🍽️ ${b("SOMEBODY COOKED")}. $${esc(symbol)} served up and walked out into the wild. Legendary.`,

  burnt: (symbol: string) => `💀 $${esc(symbol)} got burnt. Rug pulled, grill's cold. Onto the next.`,

  runItBack: (symbol: string) =>
    `🔁 $${esc(symbol)} is running it back — same setup, fresh shot. Second serving coming up.`,

  jackpot: (eth: number, usd?: number) =>
    `💰 The ${b("weekly jackpot")} is up to ${b(eth.toFixed(2) + " pETH")}` +
    `${usd ? ` (≈ $${Math.round(usd).toLocaleString()})` : ""}. Climb the board, get a cut.`,

  jackpotPaid: (eth: number, winners: number) =>
    `🏆 ${b("Jackpot paid")}: ${b(eth.toFixed(2) + " pETH")} split across ${winners} cook${winners === 1 ? "" : "s"}. New pot's already heating up.`,

  levelUp: (who: string, level: number, title: string) =>
    `📈 ${esc(who)} hit ${b("Level " + level)} — ${esc(title)}.`,

  achievement: (who: string, text: string) => `🏅 ${esc(who)} ${esc(text)}.`,

  patchNotes: (text: string) => `🛠️ ${b("Patch notes")}\n${esc(text)}`,
  announce: (text: string) => `📣 ${esc(text)}`,
};

// ---- conversation seeding --------------------------------------------------

export const seeds: string[] = [
  "Question for the pit: what's the best ticker you've seen launch here? 🔥",
  "Moon or rug — what's your read on the next coin up? 🌕🧨",
  "What's your go-to Pull Up size, and why? Talk strategy. 🍖",
  "Who's climbing the board this week? Drop your handle. 🏆",
  "New here? Ask anything. The Pit Boss doesn't bite (much).",
  "What coin do you wish someone would launch? Someone might. 🍳",
];

export function seedPrompt(): string {
  return pick(seeds);
}
