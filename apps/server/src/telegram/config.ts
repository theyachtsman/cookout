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
}

/** The deep link a player follows to bind their account (carries a one-time token). */
export function linkDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}
