import type { ChatPermissions, InlineKeyboard, TelegramApi, TgCallbackQuery, TgUser } from "./api.js";
import type { PitBossConfig } from "./config.js";
import { esc, gate } from "./voice.js";

/**
 * The Pit Boss captcha — the same gate a moderation bot runs, kept in-house so
 * we own the welcome and the verification in one branded flow (no second bot,
 * no double-welcome).
 *
 * On join: mute the newcomer and post a one-tap "I'm human" button. Tap it and
 * they're unmuted and welcomed; ignore it for two minutes and they're kicked
 * (banned-then-unbanned, so a real person can rejoin and try again). This stops
 * the bot-join floods that plague crypto groups without paying a bouncer.
 */
export const DENY: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
};
export const ALLOW: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
};
const TIMEOUT_MS = 120_000;

export class Captcha {
  private pending = new Map<string, { messageId: number; mention: string; timer: NodeJS.Timeout }>();

  constructor(
    private api: TelegramApi,
    private config: PitBossConfig,
  ) {}

  get enabled(): boolean {
    return !!this.config.captcha;
  }

  private key(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  private mention(user: TgUser): string {
    return `<a href="tg://user?id=${user.id}">${esc(user.first_name || user.username || "friend")}</a>`;
  }

  /** A new human joined — mute them and post the verification gate. */
  async onJoin(chatId: number, user: TgUser): Promise<void> {
    if (user.is_bot) return;
    const mention = this.mention(user);
    await this.api.restrictChatMember(chatId, user.id, DENY);
    const m = await this.api.sendMessage({
      chatId,
      text:
        `🔥 ${mention}, welcome to <b>The Cookout</b>.\n\n` +
        `Tap below to prove you're human, then pull up. You've got 2 minutes before the grill cools.`,
      keyboard: [[{ text: "✅ I'm human", callback_data: `verify:${user.id}` }]],
      messageThreadId: this.config.topics?.general,
    });
    if (!m) {
      // Couldn't post the gate — never leave someone trapped muted.
      await this.api.restrictChatMember(chatId, user.id, ALLOW);
      return;
    }
    const timer = setTimeout(() => void this.expire(chatId, user.id), TIMEOUT_MS);
    timer.unref(); // a pending gate must never hold the process open
    this.pending.set(this.key(chatId, user.id), { messageId: m.message_id, mention, timer });
  }

  /** A callback fired — handle it if it's a verify tap. Returns true if ours. */
  async onCallback(q: TgCallbackQuery): Promise<boolean> {
    const data = q.data ?? "";
    if (!data.startsWith("verify:")) return false;
    const targetId = data.slice("verify:".length);
    const chatId = q.message?.chat.id;
    // Only the person being verified can pass their own gate.
    if (String(q.from.id) !== targetId) {
      await this.api.answerCallbackQuery(q.id, "That button isn't yours.");
      return true;
    }
    if (chatId == null) {
      await this.api.answerCallbackQuery(q.id);
      return true;
    }
    await this.api.restrictChatMember(chatId, q.from.id, ALLOW);
    await this.api.answerCallbackQuery(q.id, "Verified — pull up! 🔥");
    const k = this.key(chatId, q.from.id);
    const p = this.pending.get(k);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(k);
      // Transform the gate into the real welcome — one clean message.
      await this.api.editMessageText(chatId, p.messageId, gate.welcome(p.mention), this.playNow());
    }
    return true;
  }

  private playNow(): InlineKeyboard {
    return [[{ text: "🎮 Play Now", url: this.config.webBase.replace(/\/$/, "") + "/" }]];
  }

  private async expire(chatId: number, userId: number): Promise<void> {
    const k = this.key(chatId, userId);
    const p = this.pending.get(k);
    if (!p) return;
    this.pending.delete(k);
    // Kick, don't permaban: ban then immediately unban so a real person can
    // rejoin and try again; a bot just never comes back.
    await this.api.banChatMember(chatId, userId);
    await this.api.unbanChatMember(chatId, userId);
    await this.api.deleteMessage(chatId, p.messageId);
  }
}
