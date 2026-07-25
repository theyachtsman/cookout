/** Everything the Pit Boss needs to know about its world, from env. */
export interface PitBossConfig {
  /** Bot @username (no @), used to build account-link deep links. */
  botUsername: string;
  /** Public website base, e.g. https://www.thecookout.fun. */
  webBase: string;
  /** The community group chat id (personal + seeded prompts land here). */
  groupChatId?: string;
  /** The announcement channel/topic id for the automated event feed. Falls
   *  back to the group when unset. */
  announcementChatId?: string;
}

/** The deep link a player follows to bind their account (carries a one-time token). */
export function linkDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}
