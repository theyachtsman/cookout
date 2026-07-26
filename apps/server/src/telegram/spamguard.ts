import type { TelegramApi, TgMessage } from "./api.js";
import { DENY } from "./captcha.js";
import type { PitBossConfig } from "./config.js";

/**
 * A light, low-false-positive spam filter — enough to skip a dedicated
 * moderation bot for most groups. Three rules, admins always exempt:
 *
 *  1. Scam blocklist — unambiguous phishing phrases → delete + mute the sender.
 *  2. Foreign group invites (t.me/+, joinchat) → delete (classic drive-by spam).
 *  3. New-member link cooldown — for the first PROBATION, links are held, so a
 *     spam account that slips past the captcha still can't drop its link.
 *
 * Deliberately does NOT keyword-filter trading talk ("pump", "moon", "ape") —
 * this is a trading community and that would nuke real conversation. Needs the
 * bot's privacy mode OFF to receive group messages at all.
 */
const PROBATION_MS = 12 * 3_600_000; // 12h: new accounts can't post links yet
const LINK_RE = /(https?:\/\/|www\.|\bt\.me\/|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|app|fi|gg|co)\b)/i;
const INVITE_RE = /t\.me\/(?:\+|joinchat\/)/i;

/** High-confidence phishing — vanishingly unlikely in legit trading chat. */
const DEFAULT_BLOCKLIST = [
  "claim your airdrop",
  "connect your wallet to claim",
  "validate your wallet",
  "wallet validation",
  "sync your wallet",
  "restore your wallet",
  "flash usdt",
  "seed phrase",
  "recovery phrase",
];

export class SpamGuard {
  private joinedAt = new Map<number, number>();
  private admins = new Set<number>();
  private blocklist: string[];

  constructor(
    private api: TelegramApi,
    private config: PitBossConfig,
  ) {
    this.blocklist = [...DEFAULT_BLOCKLIST, ...(config.spamBlocklist ?? [])]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  get enabled(): boolean {
    return !!this.config.spamFilter;
  }

  setAdmins(ids: number[]): void {
    this.admins = new Set(ids);
  }

  /** Put a member on the new-account link cooldown. */
  noteJoin(userId: number): void {
    this.joinedAt.set(userId, Date.now());
    if (this.joinedAt.size > 4000) {
      const cut = Date.now() - PROBATION_MS;
      for (const [id, t] of this.joinedAt) if (t < cut) this.joinedAt.delete(id);
    }
  }

  /** Scan one group message. Returns true if it was spam and got removed. */
  async check(msg: TgMessage): Promise<boolean> {
    const from = msg.from;
    const text = msg.text;
    if (!from || from.is_bot || !text) return false;
    if (this.admins.has(from.id)) return false; // admins post freely
    const lower = text.toLowerCase();

    const remove = async (mute: boolean, warn?: string): Promise<boolean> => {
      await this.api.deleteMessage(msg.chat.id, msg.message_id);
      if (mute) await this.api.restrictChatMember(msg.chat.id, from.id, DENY);
      if (warn) {
        const m = await this.api.sendMessage({
          chatId: msg.chat.id,
          text: warn,
          messageThreadId: msg.message_thread_id,
        });
        // Auto-remove the notice so the guard doesn't clutter the room.
        if (m) setTimeout(() => void this.api.deleteMessage(msg.chat.id, m.message_id), 8000).unref();
      }
      return true;
    };

    // 1. Phishing blocklist → delete + mute (these are unambiguous scams).
    if (this.blocklist.some((b) => lower.includes(b))) return remove(true);

    // 2. Foreign group invites → delete.
    if (INVITE_RE.test(text))
      return remove(false, "🧹 Group invite links aren't allowed here. Keep it at The Cookout.");

    // 3. New-member link cooldown.
    const joined = this.joinedAt.get(from.id);
    if (joined && Date.now() - joined < PROBATION_MS && LINK_RE.test(text))
      return remove(false, "🧹 New here? Links are held for your first few hours — hang out first, then share.");

    return false;
  }
}
