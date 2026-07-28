import { GAME_MODE_MAP, resolveNotifyPrefs, type ActivityEvent, type Address, type NotifyCategory } from "@cookout/shared";
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

  /** The rendered coin-card image for a concept (the web's OG-image route). */
  private cardImage(conceptId: string): string {
    return `${this.config.webBase.replace(/\/$/, "")}/coin/${conceptId}/opengraph-image`;
  }

  /** Round id → its concept id (lifecycle events carry the round id). */
  private conceptIdFor(roundId: string): string | undefined {
    return this.store.rounds.get(roundId)?.conceptId;
  }

  /** Coin name from a concept id, for the post headline. */
  private coinName(conceptId?: string): string | undefined {
    return conceptId ? this.store.concepts.get(conceptId)?.name : undefined;
  }

  /**
   * Like {@link toChannel}, but leads with the rendered coin card as the photo,
   * caption underneath. If Telegram can't fetch/render the image, it falls back
   * to a plain text post so an announcement is never dropped.
   */
  private toChannelPhoto(
    conceptId: string | undefined,
    caption: string,
    keyboard?: InlineKeyboard,
    topic?: TopicKey,
  ): void {
    if (!this.channelId) return;
    const threadId =
      !this.config.announcementChatId && topic ? this.config.topics?.[topic] : undefined;
    if (!conceptId) {
      void this.api.sendMessage({ chatId: this.channelId, text: caption, keyboard, messageThreadId: threadId });
      return;
    }
    const photo = this.cardImage(conceptId);
    const chatId = this.channelId;
    void (async () => {
      const sent = await this.api.sendPhoto({ chatId, photo, caption, keyboard, messageThreadId: threadId });
      if (!sent)
        void this.api.sendMessage({ chatId, text: caption, keyboard, messageThreadId: threadId });
    })();
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
        // The public post is the round-results scoreboard (kind: "results"),
        // so here we only DM the creator their moment.
        this.toOwner(e.address, "graduations", `🍽️ Your coin ${sym ? `$${esc(sym)} ` : ""}served up and walked out into the wild. Legendary cook.`);
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
    // The coin's game mode, as a display name for the feed copy.
    const mode = e.mode ? GAME_MODE_MAP[e.mode]?.name : undefined;
    switch (e.kind) {
      case "submitted":
        return this.submittedForVote(e.roundId, e.symbol, e.name, e.by, mode, e.rerun);
      case "scheduled":
        return this.scheduled(e.symbol, e.roundId, mode);
      case "votes_hit":
        return this.votesHit(e.symbol, e.roundId, e.votes ?? 0, mode);
      case "fair_open":
        return this.fairOpen(e.symbol, e.roundId, mode);
      case "live":
        return this.live(e.symbol, e.roundId, mode);
      case "burnt":
        return this.burnt(e.symbol, e.roundId, mode);
      case "results":
        return this.roundResults(e.roundId, e.symbol, mode);
      case "run_it_back":
        return this.runItBack(e.symbol, e.roundId, mode);
    }
  }

  /** The round-end scoreboard: outcome + top 5 by PnL, posted to Leaderboards. */
  roundResults(roundId: string, symbol: string, mode?: string): void {
    const summary = this.store.summaries.get(roundId);
    if (!summary) return;
    const round = this.store.rounds.get(roundId);
    const top = (summary.leaderboard ?? [])
      .slice(0, 5)
      .map((e) => ({ name: this.name(e.address), xp: Math.round(e.xp) }));
    const rug = summary.endReason === "rug_detected" || summary.endReason === "liquidity_removed";
    const [emoji, outcome] = summary.graduated
      ? ["🍽️", "Served Up · out in the wild"]
      : rug
        ? ["🔥", "Burnt · rug pulled"]
        : summary.endReason === "low_volume"
          ? ["💤", "Went quiet"]
          : summary.endReason === "mcap_target"
            ? ["🎯", "Hit the target"]
            : ["⏱️", "Time's up"];
    this.toChannelPhoto(
      round?.conceptId,
      feed.roundResults({
        symbol,
        name: round?.token.name,
        mode,
        emoji,
        outcome,
        volume: summary.totalVolume,
        peakMcapUsd: Math.round(summary.peakMcap * this.store.ethUsd),
        durationSec: summary.durationSeconds,
        holders: summary.holderCount,
        top,
      }),
      round ? this.kb.round(roundId, symbol) : this.kb.openCookout(),
      "leaderboards",
    );
  }

  // ---- explicit community-feed posts (wired from lifecycle / admin) --------

  /** A brand-new submission — announce it in the Vote Shilling pit so its
   *  creator (and the crowd) can rally votes: a jump-to-card button and a
   *  prefilled X post carrying the vote-card link. Goes to voteshill, which
   *  falls back to launch, then General. */
  submittedForVote(
    conceptId: string,
    symbol: string,
    name?: string,
    by?: string,
    mode?: string,
    rerun?: boolean,
  ): void {
    const topic: TopicKey = this.config.topics?.voteshill ? "voteshill" : "launch";
    const copy = rerun
      ? feed.voteShillRerun(symbol, name, by, mode)
      : feed.voteShill(symbol, name, by, mode);
    // For "submitted", the event's roundId IS the concept id.
    this.toChannelPhoto(conceptId, copy, this.kb.voteShill(conceptId, symbol, name), topic);
  }
  votesHit(symbol: string, roundId: string, votes: number, mode?: string): void {
    // It's booked for the Cook Out now — the button enters the match, not the
    // vote page. Lands in Trading, where the live crowd is.
    const conceptId = this.conceptIdFor(roundId);
    this.toChannelPhoto(
      conceptId,
      feed.votesHit(symbol, this.coinName(conceptId), votes, mode),
      this.kb.enterRound(roundId, symbol),
      "trading",
    );
  }
  scheduled(symbol: string, roundId: string, mode?: string): void {
    const conceptId = this.conceptIdFor(roundId);
    this.toChannelPhoto(
      conceptId,
      feed.scheduled(symbol, this.coinName(conceptId), mode),
      this.kb.round(roundId, symbol),
      "announcements",
    );
  }
  fairOpen(symbol: string, roundId: string, mode?: string): void {
    const conceptId = this.conceptIdFor(roundId);
    this.toChannelPhoto(
      conceptId,
      feed.fairOpen(symbol, this.coinName(conceptId), mode),
      this.kb.round(roundId, symbol),
      "trading",
    );
  }
  live(symbol: string, roundId: string, mode?: string): void {
    const conceptId = this.conceptIdFor(roundId);
    this.toChannelPhoto(
      conceptId,
      feed.live(symbol, this.coinName(conceptId), mode),
      this.kb.round(roundId, symbol),
      "trading",
    );
  }
  burnt(symbol: string, roundId?: string, mode?: string): void {
    const conceptId = roundId ? this.conceptIdFor(roundId) : undefined;
    this.toChannelPhoto(
      conceptId,
      feed.burnt(symbol, this.coinName(conceptId), mode),
      roundId ? this.kb.round(roundId, symbol) : this.kb.openCookout(),
      "leaderboards",
    );
  }
  runItBack(symbol: string, roundId: string, mode?: string): void {
    const conceptId = this.conceptIdFor(roundId);
    this.toChannelPhoto(
      conceptId,
      feed.runItBack(symbol, this.coinName(conceptId), mode),
      this.kb.runItBack(roundId),
      "launch",
    );
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
