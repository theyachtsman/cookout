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
    /** A coin that's made it to the Cook Out — the button enters the live match. */
    enterRound: (roundId: string, symbol?: string): InlineKeyboard => [
      [{ text: `🔥 Enter ${symbol ? "$" + symbol : "the Cook Out"}`, url: url(`/round/${roundId}`) }],
    ],
    /** A fresh submission up for a vote: jump to its card, or shill it on X with
     *  a prefilled post that carries the vote-card link. */
    voteShill: (conceptId: string, symbol: string, name?: string): InlineKeyboard => {
      const card = url(`/vote#coin-${conceptId}`);
      const tweet =
        `https://twitter.com/intent/tweet?text=` +
        encodeURIComponent(
          `🍳 $${symbol}${name ? ` (${name})` : ""} is up for a vote at The Cookout — the live ` +
            `trading pit. Send it to the grill 🔥👇`,
        ) +
        `&url=${encodeURIComponent(card)}`;
      return [
        [
          { text: `🗳️ Vote $${symbol}`, url: card },
          { text: "𝕏 Shill on X", url: tweet },
        ],
      ];
    },
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
