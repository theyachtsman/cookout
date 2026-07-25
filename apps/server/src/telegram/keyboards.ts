import type { InlineKeyboard } from "./api.js";

/**
 * Inline keyboards. Every notable message ends in a button that pulls the
 * reader back to the website — the whole point of the companion is to drive
 * people to The Cookout, so a message without a way in is a wasted message.
 */
export function makeKeyboards(webBase: string) {
  const url = (p: string) => webBase.replace(/\/$/, "") + p;
  return {
    openCookout: (): InlineKeyboard => [[{ text: "🔥 Open The Cookout", url: url("/matches") }]],
    playNow: (): InlineKeyboard => [[{ text: "🎮 Play Now", url: url("/") }]],
    leaderboard: (): InlineKeyboard => [[{ text: "🏆 Leaderboard", url: url("/leaderboard") }]],
    jackpot: (): InlineKeyboard => [[{ text: "💰 View Jackpot", url: url("/jackpot") }]],
    vote: (): InlineKeyboard => [[{ text: "🗳️ Vote it up", url: url("/vote") }]],
    round: (roundId: string, symbol?: string): InlineKeyboard => [
      [{ text: `📈 View ${symbol ? "$" + symbol : "coin"}`, url: url(`/round/${roundId}`) }],
    ],
    graduated: (roundId: string): InlineKeyboard => [
      [
        { text: "🍽️ See the serve", url: url(`/round/${roundId}`) },
        { text: "🔥 Pull Up", url: url("/matches") },
      ],
    ],
    runItBack: (roundId: string): InlineKeyboard => [
      [{ text: "🔁 Run It Back", url: url(`/round/${roundId}`) }],
    ],
    profile: (address: string): InlineKeyboard => [
      [{ text: "👤 View profile", url: url(`/profile/${address}`) }],
    ],
  };
}

export type Keyboards = ReturnType<typeof makeKeyboards>;
