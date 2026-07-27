/**
 * The seven community topics. Five receive the automated feed; "feedback" and
 * "support" are human-conversation spaces (no auto-posts) but are wired so the
 * admin broadcaster and pinned-message setup can target them too.
 */
export type TopicKey =
  | "announcements"
  | "general"
  | "feedback"
  | "launch"
  | "voteshill"
  | "trading"
  | "leaderboards"
  | "support";

/** Everything the Pit Boss needs to know about its world, from env. */
export interface PitBossConfig {
  /** Bot @username (no @), used to build account-link deep links. */
  botUsername: string;
  /** Public website base, e.g. https://www.thecookout.fun. */
  webBase: string;
  /** The community group chat id (personal + seeded prompts land here). */
  groupChatId?: string;
  /** A SEPARATE announcement channel, if you run one. Leave unset when your
   *  "Announcements" is a topic inside the group — use `topics` for that. */
  announcementChatId?: string;
  /** Forum topic thread ids, so feed posts land in the right topic instead of
   *  General. Any unset key falls back to General. */
  topics?: Partial<Record<TopicKey, number>>;
  /** Post a goodbye when someone leaves (default off — leave-spam is noise). */
  goodbye?: boolean;
  /** The group's invite link (t.me/+…), surfaced as a one-tap Join button after
   *  linking. Bots can't force-add members, so an invite button is the way in. */
  groupInvite?: string;
  /** Gate new members behind a click-to-verify captcha (mute → verify → unmute,
   *  kick on timeout). Needs the bot to have restrict + delete admin rights. */
  captcha?: boolean;
  /** Delete spam: new-member link cooldown, foreign group invites, and a scam
   *  phrase blocklist. Needs the bot's privacy mode OFF to see group messages. */
  spamFilter?: boolean;
  /** Extra scam phrases (lowercased substring match) on top of the defaults. */
  spamBlocklist?: string[];
}

/**
 * Telegram's "General" topic is the forum ROOT: it has no addressable thread id,
 * and posting with message_thread_id=1 throws "message thread not found". A
 * message sent with no thread lands in General — so strip any topic pinned to id
 * 1 (the General sentinel) and let it fall through to the root. Mutates in place
 * and returns the same object for convenience.
 */
export function normalizeTopics(
  topics?: Partial<Record<TopicKey, number>>,
): Partial<Record<TopicKey, number>> | undefined {
  if (!topics) return topics;
  for (const k of Object.keys(topics) as TopicKey[]) {
    if (topics[k] === 1) topics[k] = undefined;
  }
  return topics;
}

/** The deep link a player follows to bind their account (carries a one-time token). */
export function linkDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}
