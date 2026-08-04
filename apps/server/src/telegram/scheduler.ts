/**
 * Scheduled Telegram posts.
 *
 * Runs off the main tick. Each post carries its own last-sent stamp and its
 * next-due time is computed from that, so a restart can never double-post and a
 * window missed while the process was down doesn't fire a backlog when it comes
 * back — it just waits for the next one. Recurring posts are UTC so the
 * schedule doesn't drift with daylight saving.
 */
import { isDue, renderTemplate, type ScheduledPost } from "@cookout/shared";
import type { Store } from "./../store.js";
import type { PitBoss } from "./bot.js";

export class TelegramScheduler {
  /** Guards against two ticks overlapping on a slow send. */
  private sending = new Set<string>();

  constructor(
    private store: Store,
    private boss: PitBoss | null,
  ) {}

  tick(now = Date.now()): void {
    const tg = this.store.settings.telegram;
    if (!tg.enabled || !this.boss) return;
    for (const post of tg.scheduled) {
      if (this.sending.has(post.id)) continue;
      if (!isDue(post, now)) continue;
      this.sending.add(post.id);
      // Stamp before sending: a send that fails should not immediately retry on
      // the next tick and spam the channel with attempts.
      post.lastSentAt = now;
      void this.send(post).finally(() => this.sending.delete(post.id));
    }
  }

  private async send(post: ScheduledPost): Promise<void> {
    const text = renderTemplate(post.text, this.vars());
    const ok = await this.boss!.postToTopic(text, post.topic, post.imageAssetId);
    this.store.logTelegram({
      kind: ok ? "sent" : "failed",
      target: post.topic,
      source: `schedule:${post.name}`,
      text: text.slice(0, 300),
      error: ok ? undefined : "Telegram rejected the message",
    });
  }

  /** Live values a scheduled post's placeholders can reference. */
  private vars(): Record<string, string | number> {
    const live = [...this.store.rounds.values()].filter((r) => r.state === "live");
    return {
      jackpot: `$${Math.round(this.store.jackpotPool * this.store.ethUsd).toLocaleString()}`,
      site: this.store.settings.telegram.webBase || "https://www.thecookout.fun",
      match_number: live[0]?.id.slice(0, 6) ?? "—",
      coin: live[0] ? `$${live[0].token.symbol}` : "—",
      time_remaining: live[0]?.endsAt
        ? `${Math.max(0, Math.round((live[0].endsAt - Date.now()) / 60_000))}m`
        : "—",
    };
  }
}
