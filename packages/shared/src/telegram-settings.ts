/**
 * Telegram operations, database-backed.
 *
 * The Pit Boss has always been configured from environment variables, which
 * means changing a chat id or muting an announcement needed a redeploy. These
 * settings sit in front of that: anything set here wins, anything left blank
 * falls through to the env value the bot booted with. So an operator can
 * retarget a channel or silence a noisy event from the Command Center, and a
 * fresh deployment with only env vars still works exactly as before.
 *
 * Player-facing Telegram *notification preferences* are a separate thing and
 * stay on the user's own Settings page — those are personal, not operational.
 */
/**
 * The community topics. Five receive the automated feed; "feedback" and
 * "support" are human-conversation spaces (no auto-posts) but are still
 * addressable by the broadcaster.
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

/** A community topic that automated posts can target. */
export const TELEGRAM_TOPICS: { key: TopicKey; label: string; description: string }[] = [
  { key: "announcements", label: "Announcements", description: "Official posts" },
  { key: "general", label: "General", description: "The main room" },
  { key: "launch", label: "Launch", description: "New coins hitting the grill" },
  { key: "voteshill", label: "Vote Shilling", description: "Coins rallying votes" },
  { key: "trading", label: "Trading", description: "Live match beats" },
  { key: "leaderboards", label: "Leaderboards", description: "Results and standings" },
  { key: "feedback", label: "Feedback", description: "Human conversation — no auto-posts" },
  { key: "support", label: "Support", description: "Human conversation — no auto-posts" },
];

/**
 * Automated notifications the platform can post. Each is independently
 * switchable and has an editable template; leaving a template blank uses the
 * bot's built-in copy, which is richer than a template can express (buttons,
 * photos, computed tables).
 */
export interface TelegramEventDef {
  key: string;
  label: string;
  description: string;
  group: string;
  /** Topic it posts to by default. */
  topic: TopicKey;
  /** Placeholders this event can substitute. */
  placeholders: string[];
}

export const TELEGRAM_EVENTS: TelegramEventDef[] = [
  { key: "submitted", label: "Coin submitted", description: "A new coin goes up for a vote", group: "Match lifecycle", topic: "voteshill", placeholders: ["coin", "name", "creator", "mode"] },
  { key: "votes_hit", label: "Vote passed", description: "A coin clears the vote bar", group: "Match lifecycle", topic: "launch", placeholders: ["coin", "votes", "mode"] },
  { key: "scheduled", label: "Match scheduled", description: "A coin lands on the calendar", group: "Match lifecycle", topic: "launch", placeholders: ["coin", "mode"] },
  { key: "fair_open", label: "Fair Open", description: "The auction opens", group: "Match lifecycle", topic: "trading", placeholders: ["coin", "mode"] },
  { key: "live", label: "Trading live", description: "A match goes live", group: "Match lifecycle", topic: "trading", placeholders: ["coin", "mode"] },
  { key: "results", label: "Match results", description: "The end-of-round scoreboard", group: "Match lifecycle", topic: "leaderboards", placeholders: ["coin", "winner", "mode"] },
  { key: "graduated", label: "Coin served up", description: "A coin completes its bond", group: "Match lifecycle", topic: "leaderboards", placeholders: ["coin", "creator"] },
  { key: "burnt", label: "Coin burnt", description: "A rug is detected", group: "Match lifecycle", topic: "trading", placeholders: ["coin", "creator"] },
  { key: "run_it_back", label: "Run It Back", description: "A failed coin returns to the vote", group: "Match lifecycle", topic: "voteshill", placeholders: ["coin", "creator"] },
  { key: "jackpot", label: "Jackpot paid", description: "The weekly jackpot settles", group: "Economy", topic: "leaderboards", placeholders: ["winner", "jackpot", "reward"] },
  { key: "leaderboard", label: "Leaderboard update", description: "Weekly standings", group: "Economy", topic: "leaderboards", placeholders: ["winner", "xp"] },
  { key: "pit_result", label: "Pit results", description: "A Pit match resolves", group: "The Pit", topic: "leaderboards", placeholders: ["coin", "winner", "reward"] },
  { key: "trial_result", label: "Flame Trial results", description: "A Flame Trial resolves", group: "The Pit", topic: "leaderboards", placeholders: ["coin", "winner", "xp"] },
  { key: "maintenance", label: "Maintenance notice", description: "Planned downtime", group: "Platform", topic: "announcements", placeholders: [] },
  { key: "event", label: "Event announcement", description: "Seasonal or special events", group: "Platform", topic: "announcements", placeholders: [] },
];

/** Every placeholder a template may use, with what it resolves to. */
export const TELEGRAM_PLACEHOLDERS: { key: string; description: string }[] = [
  { key: "coin", description: "The coin's ticker, e.g. $WAGYU" },
  { key: "name", description: "The coin's full name" },
  { key: "creator", description: "The coin's developer" },
  { key: "winner", description: "The winning player" },
  { key: "mode", description: "The game mode" },
  { key: "votes", description: "Vote count" },
  { key: "xp", description: "XP amount" },
  { key: "jackpot", description: "The jackpot total" },
  { key: "reward", description: "A payout amount" },
  { key: "match_number", description: "The match's number" },
  { key: "time_remaining", description: "Time left on the clock" },
  { key: "site", description: "The public site URL" },
];

export interface TelegramEventSettings {
  enabled: boolean;
  /** Blank = the bot's built-in copy for this event. */
  template: string;
  /** Media Library asset id attached to the post. */
  imageAssetId?: string;
  /** Override the topic this event posts to. */
  topic?: TopicKey;
}

/** A bot command. Responses can be overridden with static text. */
export interface TelegramCommandSettings {
  enabled: boolean;
  description: string;
  /** Blank = the bot's built-in, data-driven answer. */
  response: string;
  /** Only group admins may run it. */
  adminOnly: boolean;
}

export type ScheduleCadence = "once" | "daily" | "weekly" | "monthly";

export interface ScheduledPost {
  id: string;
  name: string;
  text: string;
  topic: TopicKey;
  cadence: ScheduleCadence;
  /** UTC hour/minute for recurring posts. */
  hourUtc: number;
  minuteUtc: number;
  /** 0 = Sunday. Weekly only. */
  weekday?: number;
  /** 1–28. Monthly only — capped so every month has the day. */
  dayOfMonth?: number;
  /** Epoch ms. "once" only. */
  runAt?: number;
  imageAssetId?: string;
  enabled: boolean;
  lastSentAt?: number;
  createdAt: number;
}

export interface TelegramModerationSettings {
  welcomeMessage: string;
  captcha: boolean;
  spamFilter: boolean;
  /** Extra blocked phrases, lowercased substring match. */
  blocklist: string[];
  /** Delete messages containing links from members below this many minutes old. */
  linkCooldownMinutes: number;
  /** Seconds a member must wait between messages. 0 = off. */
  slowModeSeconds: number;
  /** Post a goodbye when someone leaves. */
  goodbye: boolean;
}

export interface TelegramSettings {
  /** Overrides for the env-provided connection. Blank = use env. */
  botUsername: string;
  webBase: string;
  groupChatId: string;
  announcementChatId: string;
  groupInvite: string;
  topics: Partial<Record<TopicKey, number>>;
  events: Record<string, TelegramEventSettings>;
  commands: Record<string, TelegramCommandSettings>;
  scheduled: ScheduledPost[];
  moderation: TelegramModerationSettings;
  /** Master switch — off silences every automated post without unsetting the token. */
  enabled: boolean;
}

export function freshTelegramSettings(
  commands: { command: string; description: string }[] = [],
): TelegramSettings {
  return {
    botUsername: "",
    webBase: "",
    groupChatId: "",
    announcementChatId: "",
    groupInvite: "",
    topics: {},
    events: Object.fromEntries(
      TELEGRAM_EVENTS.map((e) => [e.key, { enabled: true, template: "" } satisfies TelegramEventSettings]),
    ),
    commands: Object.fromEntries(
      commands.map((c) => [
        c.command,
        { enabled: true, description: c.description, response: "", adminOnly: false },
      ]),
    ),
    scheduled: [],
    moderation: {
      welcomeMessage: "",
      captcha: false,
      spamFilter: false,
      blocklist: [],
      linkCooldownMinutes: 10,
      slowModeSeconds: 0,
      goodbye: false,
    },
    enabled: true,
  };
}

/** Fill in events, commands and moderation added since a snapshot was written. */
export function mergeTelegramSettings(
  stored: Partial<TelegramSettings> | undefined,
  commands: { command: string; description: string }[] = [],
): TelegramSettings {
  const fresh = freshTelegramSettings(commands);
  if (!stored) return fresh;
  return {
    ...fresh,
    ...stored,
    topics: { ...fresh.topics, ...(stored.topics ?? {}) },
    events: { ...fresh.events, ...(stored.events ?? {}) },
    commands: { ...fresh.commands, ...(stored.commands ?? {}) },
    scheduled: stored.scheduled ?? [],
    moderation: { ...fresh.moderation, ...(stored.moderation ?? {}) },
  };
}

/** Substitute {placeholders}. Unknown ones are left visible rather than blanked,
 *  so a typo in a template shows up instead of silently eating the word. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * When a recurring post is next due, in epoch ms. Returns null when it will
 * never run again (a one-off that has already fired, or a disabled post).
 *
 * Recurring posts are evaluated against the last send rather than a stored
 * cursor, so a restart can't double-post and a missed window doesn't stack up.
 */
export function nextDue(post: ScheduledPost, now: number): number | null {
  if (!post.enabled) return null;
  if (post.cadence === "once") {
    if (!post.runAt || post.lastSentAt) return null;
    return post.runAt;
  }
  const d = new Date(now);
  const at = (base: Date) => {
    const x = new Date(base);
    x.setUTCHours(post.hourUtc, post.minuteUtc, 0, 0);
    return x.getTime();
  };
  if (post.cadence === "daily") {
    let t = at(d);
    if (t <= (post.lastSentAt ?? 0) || t <= now - 60_000) t += 86_400_000;
    return t;
  }
  if (post.cadence === "weekly") {
    const target = post.weekday ?? 1;
    const base = new Date(d);
    const delta = (target - base.getUTCDay() + 7) % 7;
    base.setUTCDate(base.getUTCDate() + delta);
    let t = at(base);
    if (t <= (post.lastSentAt ?? 0) || t <= now - 60_000) t += 7 * 86_400_000;
    return t;
  }
  // monthly
  const day = Math.min(28, Math.max(1, post.dayOfMonth ?? 1));
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day));
  let t = at(base);
  if (t <= (post.lastSentAt ?? 0) || t <= now - 60_000) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day));
    t = at(next);
  }
  return t;
}

/** Is a scheduled post due to fire right now? */
export function isDue(post: ScheduledPost, now: number): boolean {
  const due = nextDue(post, now);
  return due !== null && due <= now;
}

/** One line in the Telegram delivery log. */
export interface TelegramLogEntry {
  id: string;
  at: number;
  kind: "sent" | "failed" | "command" | "error";
  /** Chat/topic or command name. */
  target?: string;
  /** Event key or scheduled-post name that produced it. */
  source?: string;
  text?: string;
  error?: string;
}
