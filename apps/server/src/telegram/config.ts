/** Which forum topic (message thread) a class of post belongs in. */
export type TopicKey = "announcements" | "launch" | "trading" | "leaderboards" | "general";

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
}

/** The deep link a player follows to bind their account (carries a one-time token). */
export function linkDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}
