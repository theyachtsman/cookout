import type { Store } from "../store.js";
import { TelegramApi } from "./api.js";
import { Commands, COMMANDS } from "./commands.js";
import type { PitBossConfig } from "./config.js";
import { Notifier } from "./notify.js";
import { seedPrompt } from "./voice.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The Pit Boss: one long-poll loop pulling updates, a command desk, a notifier
 * tapped into the game's activity stream, and a gentle conversation seeder that
 * only speaks up when the room's gone quiet. Everything is failure-tolerant —
 * the game server never depends on Telegram being reachable.
 */
export class PitBoss {
  readonly notifier: Notifier;
  private commands: Commands;
  private offset = 0;
  private running = false;
  private lastGroupActivityAt = Date.now();
  private lastSeedAt = 0;
  private seedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: Store,
    private api: TelegramApi,
    readonly config: PitBossConfig,
  ) {
    this.notifier = new Notifier(store, api, config);
    this.commands = new Commands(store, api, config);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const me = await this.api.getMe();
    if (!me) {
      console.warn("[pitboss] getMe failed — check TELEGRAM_BOT_TOKEN. Bot stays dormant.");
      this.running = false;
      return;
    }
    await this.api.setMyCommands(COMMANDS);
    // Tap the live activity stream instead of polling game state.
    this.store.onActivityEvent((e) => this.notifier.handleActivity(e));
    console.log(`[pitboss] online as @${me.username} — companion armed`);
    this.startSeeding();
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.seedTimer) clearInterval(this.seedTimer);
    this.seedTimer = null;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const updates = await this.api.getUpdates(this.offset, 50);
      if (updates === null) {
        // Transient failure — breathe so we don't hammer a hot loop.
        await sleep(2000);
        continue;
      }
      for (const up of updates) {
        this.offset = up.update_id + 1;
        try {
          if (up.message) {
            if (String(up.message.chat.id) === this.config.groupChatId)
              this.lastGroupActivityAt = Date.now();
            await this.commands.handleMessage(up.message);
          } else if (up.callback_query) {
            await this.commands.handleCallback(up.callback_query);
          }
        } catch (e) {
          console.warn("[pitboss] update error:", (e as Error).message);
        }
      }
    }
  }

  /**
   * Conversation seeding: if the group has a chat id and has gone quiet for a
   * good while, drop a single question. Hard rate-limited so it's a nudge, not
   * spam — at most once every 6 hours, and only after 90 minutes of silence.
   */
  private startSeeding(): void {
    if (!this.config.groupChatId) return;
    this.seedTimer = setInterval(
      () => {
        const now = Date.now();
        if (now - this.lastGroupActivityAt < 90 * 60_000) return; // room's alive
        if (now - this.lastSeedAt < 6 * 3_600_000) return; // already nudged recently
        this.lastSeedAt = now;
        this.lastGroupActivityAt = now; // our own prompt counts as activity
        void this.api.sendMessage({
          chatId: this.config.groupChatId!,
          text: seedPrompt(),
          silent: true,
          messageThreadId: this.config.topics?.general,
        });
      },
      15 * 60_000,
    );
  }
}

/**
 * Build the Pit Boss from the environment. Returns null (a total no-op) unless
 * TELEGRAM_BOT_TOKEN is set, so nothing here touches a deployment that hasn't
 * opted in. Construction is cheap; call start() to begin polling.
 */
export function createPitBoss(store: Store): PitBoss | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const config: PitBossConfig = {
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "pitboss_cookout_bot",
    webBase: process.env.WEB_BASE_URL ?? "https://www.thecookout.fun",
    groupChatId: process.env.TELEGRAM_GROUP_CHAT_ID,
    announcementChatId: process.env.TELEGRAM_ANNOUNCEMENT_CHAT_ID,
    topics: {
      announcements: num(process.env.TELEGRAM_TOPIC_ANNOUNCEMENTS),
      general: num(process.env.TELEGRAM_TOPIC_GENERAL),
      feedback: num(process.env.TELEGRAM_TOPIC_FEEDBACK),
      launch: num(process.env.TELEGRAM_TOPIC_LAUNCH),
      trading: num(process.env.TELEGRAM_TOPIC_TRADING),
      leaderboards: num(process.env.TELEGRAM_TOPIC_LEADERBOARDS),
      support: num(process.env.TELEGRAM_TOPIC_SUPPORT),
    },
  };
  return new PitBoss(store, new TelegramApi(token), config);
}
