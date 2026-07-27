import { resolveNotifyPrefs, type ActivityEvent, type Address, type NotifyCategory } from "@cookout/shared";
import type { RoundEvent, Store } from "../store.js";
import type { InlineKeyboard, TelegramApi } from "./api.js";
import type { PitBossConfig, TopicKey } from "./config.js";
import { makeKeyboards, type Keyboards } from "./keyboards.js";
import { esc, feed, say } from "./voice.js";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Turns game events into Pit Boss messages and routes them:
 *  - personal DMs to the player they're about (pref-gated),
 *  - DMs to that player's linked followers (pref-gated),
 *  - and marquee posts to the community channel.
 *
 * The activity stream (store.onActivityEvent) already carries the big moments —
 * graduations, jackpots, level-ups, achievements, submissions — so we tap that
 * rather than poll. Lifecycle channel posts (fair open, live, burn…) come in
 * through the explicit announce* methods.
 */
export class Notifier {
  readonly kb: Keyboards;
  private channelId?: string;

  constructor(
    private store: Store,
    private api: TelegramApi,
    private config: PitBossConfig,
  ) {
    this.kb = makeKeyboards(config.webBase);
    this.channelId = config.announcementChatId ?? config.groupChatId;
  }

  private name(address: Address): string {
    return this.store.users.get(address.toLowerCase())?.displayName ?? short(address);
  }

  /** DM one player about their own moment, if linked and opted in. */
  toOwner(address: Address, category: NotifyCategory, text: string, keyboard?: InlineKeyboard): void {
    const u = this.store.users.get(address.toLowerCase());
    if (!u?.telegram) return;
    if (!resolveNotifyPrefs(u.notifyPrefs)[category]) return;
    void this.api.sendMessage({ chatId: u.telegram.chatId, text, keyboard });
  }

  /** DM the linked followers of a player about that player's moment. */
  toFollowers(subject: Address, text: string, keyboard?: InlineKeyboard): void {
    const target = subject.toLowerCase();
    for (const u of this.store.linkedTelegramUsers()) {
      if (u.address === target) continue;
      if (!u.following?.includes(target)) continue;
      if (!resolveNotifyPrefs(u.notifyPrefs).followedPlayers) continue;
      void this.api.sendMessage({ chatId: u.telegram!.chatId, text, keyboard });
    }
  }

  /**
   * Post to the community feed. When "Announcements" (and friends) are forum
   * topics inside the group — the common case — we target the topic's thread so
   * it lands in the right place; a separate announcement channel (no topics)
   * just gets the post. Unknown/unset topics fall back to General.
   */
  toChannel(text: string, keyboard?: InlineKeyboard, topic?: TopicKey): void {
    if (!this.channelId) return;
    // Threads only apply to the forum group, not a standalone channel.
    const threadId =
      !this.config.announcementChatId && topic ? this.config.topics?.[topic] : undefined;
    void this.api.sendMessage({ chatId: this.channelId, text, keyboard, messageThreadId: threadId });
  }

  // ---- the activity tap ----------------------------------------------------

  handleActivity(e: ActivityEvent): void {
    const who = this.name(e.address);
    const u = this.store.users.get(e.address.toLowerCase());
    const sym = e.roundSymbol;
    switch (e.kind) {
      case "level_up": {
        const lvl = u?.level ?? 0;
        const title = u?.title ?? "";
        this.toOwner(e.address, "levelUps", say.levelUp(lvl, title), this.kb.openCookout());
        this.toFollowers(e.address, say.followed(who, `hit Level ${lvl}`));
        // Only milestone levels reach the channel, so the feed stays worth reading.
        if (lvl >= 10 && lvl % 5 === 0) this.toChannel(feed.levelUp(who, lvl, title), undefined, "leaderboards");
        break;
      }
      case "achievement":
        this.toOwner(e.address, "achievements", say.achievement(e.text), this.kb.openCookout());
        this.toFollowers(e.address, say.followed(who, e.text));
        break;
      case "graduated":
        this.toOwner(e.address, "graduations", `🍽️ Your coin ${sym ? `$${esc(sym)} ` : ""}served up and walked out into the wild. Legendary cook.`);
        this.toChannel(feed.graduated(sym ?? "coin"), e.roundId ? this.kb.graduated(e.roundId) : this.kb.openCookout(), "leaderboards");
        break;
      case "rekt":
        this.toOwner(e.address, "rugs", `💀 You got burnt${sym ? ` in $${esc(sym)}` : ""}. Grill's cold on that one. Onto the next.`);
        break;
      case "won":
        this.toOwner(e.address, "trading", `🍖 You cooked${sym ? ` in $${esc(sym)}` : ""}. That's a plate.`);
        this.toFollowers(e.address, say.followed(who, `cooked${sym ? ` in $${esc(sym)}` : ""}`));
        break;
      case "jackpot":
        this.toOwner(e.address, "jackpot", `💰 ${esc(e.text)} Come collect.`, this.kb.jackpot());
        this.toChannel(`💰 ${b(esc(who))} ${esc(e.text)}`, this.kb.jackpot(), "leaderboards");
        break;
      case "submitted":
        this.toChannel(feed.submitted(sym ?? "?", "", who), this.kb.vote(), "launch");
        break;
      case "pulled_up":
        this.toFollowers(e.address, say.followed(who, `pulled up${sym ? ` to $${esc(sym)}` : ""}`), sym && e.roundId ? this.kb.round(e.roundId, sym) : undefined);
        break;
      // "joined" is intentionally quiet — no one needs a ping for every arrival.
    }
  }

  // ---- the round-lifecycle tap ---------------------------------------------

  handleRoundEvent(e: RoundEvent): void {
    switch (e.kind) {
      case "submitted":
        return this.submittedForVote(e.roundId, e.symbol, e.name, e.by);
      case "scheduled":
        return this.scheduled(e.symbol, e.roundId);
      case "votes_hit":
        return this.votesHit(e.symbol, e.roundId, e.votes ?? 0);
      case "fair_open":
        return this.fairOpen(e.symbol, e.roundId);
      case "live":
        return this.live(e.symbol, e.roundId);
      case "burnt":
        return this.burnt(e.symbol, e.roundId);
      case "run_it_back":
        return this.runItBack(e.symbol, e.roundId);
    }
  }

  // ---- explicit community-feed posts (wired from lifecycle / admin) --------

  /** A brand-new submission — announce it in the Vote Shilling pit so its
   *  creator (and the crowd) can rally votes: a jump-to-card button and a
   *  prefilled X post carrying the vote-card link. Goes to voteshill, which
   *  falls back to launch, then General. */
  submittedForVote(conceptId: string, symbol: string, name?: string, by?: string): void {
    const topic: TopicKey = this.config.topics?.voteshill ? "voteshill" : "launch";
    this.toChannel(feed.voteShill(symbol, name, by), this.kb.voteShill(conceptId, symbol, name), topic);
  }
  votesHit(symbol: string, roundId: string, votes: number): void {
    // It's booked for the Cook Out now — the button enters the match, not the
    // vote page. Lands in Trading, where the live crowd is.
    this.toChannel(feed.votesHit(symbol, votes), this.kb.enterRound(roundId, symbol), "trading");
  }
  scheduled(symbol: string, roundId: string): void {
    this.toChannel(feed.scheduled(symbol), this.kb.round(roundId, symbol), "announcements");
  }
  fairOpen(symbol: string, roundId: string): void {
    this.toChannel(feed.fairOpen(symbol), this.kb.round(roundId, symbol), "trading");
  }
  live(symbol: string, roundId: string): void {
    this.toChannel(feed.live(symbol), this.kb.round(roundId, symbol), "trading");
  }
  burnt(symbol: string, roundId?: string): void {
    this.toChannel(feed.burnt(symbol), roundId ? this.kb.round(roundId, symbol) : this.kb.openCookout(), "leaderboards");
  }
  runItBack(symbol: string, roundId: string): void {
    this.toChannel(feed.runItBack(symbol), this.kb.runItBack(roundId), "launch");
  }
  jackpotGrew(eth: number, usd?: number): void {
    this.toChannel(feed.jackpot(eth, usd), this.kb.jackpot(), "announcements");
  }
  patchNotes(text: string): void {
    this.toChannel(feed.patchNotes(text), this.kb.openCookout(), "announcements");
  }
  announce(text: string): void {
    this.toChannel(feed.announce(text), this.kb.openCookout(), "announcements");
  }
}

const b = (s: string) => `<b>${s}</b>`;
