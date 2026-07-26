import type { TelegramApi, TgUser } from "./api.js";
import { ALLOW, DENY } from "./captcha.js";
import { esc } from "./voice.js";

/**
 * Reply-based moderation for admins — the tools a dedicated mod bot would give
 * you, in the Pit Boss. Reply to a message and run a command. Authorization
 * (admin-only, group-only, target isn't a bot/admin) is enforced by the caller.
 *
 *   /mute [1h|30m|2d]   mute the replied-to user (permanent with no time)
 *   /unmute             lift a mute
 *   /ban [1d|1w]        ban (permanent with no time)
 *   /unban              lift a ban
 *   /kick               remove but allow rejoin
 *   /warn               warn; 3 warnings auto-mutes
 *   /unwarn             clear warnings
 */
export const MOD_COMMANDS = new Set([
  "/mute",
  "/unmute",
  "/ban",
  "/unban",
  "/kick",
  "/warn",
  "/unwarn",
]);
const WARN_LIMIT = 3;

/** "90m" / "2h" / "3d" / "1w" → a unix "until" timestamp + a label, else forever. */
function until(arg?: string): { untilDate?: number; label: string } {
  const m = /^(\d+)(m|h|d|w)$/.exec(arg ?? "");
  if (!m) return { label: "" };
  const secs = Number(m[1]) * { m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as "m" | "h" | "d" | "w"];
  return { untilDate: Math.floor(Date.now() / 1000) + secs, label: ` for ${m[1]}${m[2]}` };
}

export class Mod {
  private warns = new Map<number, number>();

  constructor(private api: TelegramApi) {}

  private mention(u: TgUser): string {
    return `<a href="tg://user?id=${u.id}">${esc(u.first_name || u.username || "user")}</a>`;
  }
  private say(chatId: number, text: string, thread?: number): void {
    void this.api.sendMessage({ chatId, text, messageThreadId: thread });
  }

  async run(
    cmd: string,
    chatId: number,
    thread: number | undefined,
    target: TgUser,
    arg?: string,
  ): Promise<void> {
    const who = this.mention(target);
    switch (cmd) {
      case "/mute": {
        const { untilDate, label } = until(arg);
        await this.api.restrictChatMember(chatId, target.id, DENY, untilDate);
        this.say(chatId, `🔇 Muted ${who}${label}.`, thread);
        break;
      }
      case "/unmute":
        await this.api.restrictChatMember(chatId, target.id, ALLOW);
        this.say(chatId, `🔊 Unmuted ${who}.`, thread);
        break;
      case "/ban": {
        const { untilDate, label } = until(arg);
        await this.api.banChatMember(chatId, target.id, untilDate);
        this.say(chatId, `⛔ Banned ${who}${label}.`, thread);
        break;
      }
      case "/unban":
        await this.api.unbanChatMember(chatId, target.id);
        this.say(chatId, `✅ Unbanned ${who}. They can rejoin.`, thread);
        break;
      case "/kick":
        await this.api.banChatMember(chatId, target.id);
        await this.api.unbanChatMember(chatId, target.id);
        this.say(chatId, `👋 Kicked ${who}. They can rejoin.`, thread);
        break;
      case "/warn": {
        const n = (this.warns.get(target.id) ?? 0) + 1;
        if (n >= WARN_LIMIT) {
          this.warns.delete(target.id);
          await this.api.restrictChatMember(chatId, target.id, DENY);
          this.say(chatId, `⚠️ ${who} hit ${WARN_LIMIT} warnings — muted. /unmute to lift.`, thread);
        } else {
          this.warns.set(target.id, n);
          this.say(chatId, `⚠️ Warned ${who} (${n}/${WARN_LIMIT}).`, thread);
        }
        break;
      }
      case "/unwarn":
        this.warns.delete(target.id);
        this.say(chatId, `✅ Cleared warnings for ${who}.`, thread);
        break;
    }
  }
}
