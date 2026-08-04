/**
 * The Cookout Command Center — the internal operations platform.
 *
 * This file is the contract between the CMS server and its UI: who may do
 * what, what gets audited, and which parts of the platform can be switched off
 * without a deploy. Everything here is data, so new modules and permissions are
 * configuration rather than a restructure.
 *
 * Authorization is enforced ONLY on the server (see apps/server/src/staff.ts).
 * The permission helpers below are shared so the UI can hide what a staffer
 * can't use — that is a convenience, never the control.
 */

/** A Command Center module. Adding one here puts it in the nav and the search. */
export type CcModule =
  | "dashboard"
  | "users"
  | "game"
  | "economy"
  | "content"
  | "branding"
  | "themes"
  | "media"
  | "audio"
  | "telegram"
  | "goons"
  | "nft"
  | "moderation"
  | "analytics"
  | "flags"
  | "team"
  | "audit"
  | "backups";

/**
 * Granular permissions, `area.verb`. Roles are bundles of these, and every
 * account can additionally be granted or denied individual permissions, so
 * "this moderator may also edit quests" needs no new role.
 */
export type Permission =
  // team + security
  | "staff.view"
  | "staff.manage"
  | "security.manage"
  // players
  | "users.view"
  | "users.moderate"
  | "users.economy"
  // gameplay
  | "game.config"
  | "matches.control"
  // content + presentation
  | "content.manage"
  | "assets.manage"
  | "themes.manage"
  // integrations
  | "telegram.manage"
  | "telegram.moderate"
  // platform
  | "flags.manage"
  | "analytics.view"
  | "audit.view"
  | "backups.manage";

export interface PermissionDef {
  key: Permission;
  label: string;
  description: string;
  /** Grouping for the permission editor. */
  group: "Team" | "Players" | "Gameplay" | "Content" | "Integrations" | "Platform";
  /** Permissions that can hand out access or move real value. Owner-only by
   *  default, and always called out in the UI. */
  sensitive?: boolean;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: "staff.view", label: "View team", description: "See staff accounts and their roles", group: "Team" },
  { key: "staff.manage", label: "Manage team", description: "Create, edit, disable and delete staff accounts", group: "Team", sensitive: true },
  { key: "security.manage", label: "Manage security", description: "Session policy, 2FA enforcement, lockouts", group: "Team", sensitive: true },

  { key: "users.view", label: "View players", description: "Browse player profiles, wallets and history", group: "Players" },
  { key: "users.moderate", label: "Moderate players", description: "Ban, suspend, mute, restore, clear flags", group: "Players" },
  { key: "users.economy", label: "Adjust balances", description: "Grant or deduct XP, pETH and BURGERS", group: "Players", sensitive: true },

  { key: "game.config", label: "Game configuration", description: "Trading, Pit, XP, quests and economy values", group: "Gameplay" },
  { key: "matches.control", label: "Match control", description: "Schedule, pause, resume and end live matches", group: "Gameplay" },

  { key: "content.manage", label: "Manage content", description: "Announcements, quests, achievements, NFTs", group: "Content" },
  { key: "assets.manage", label: "Manage assets", description: "Media library, audio and branding", group: "Content" },
  { key: "themes.manage", label: "Manage themes", description: "Seasonal themes: create, schedule and activate", group: "Content" },

  { key: "telegram.manage", label: "Telegram operations", description: "Bot, channels, templates and scheduled posts", group: "Integrations" },
  { key: "telegram.moderate", label: "Telegram moderation", description: "Mutes, bans and filters in the Telegram group", group: "Integrations" },

  { key: "flags.manage", label: "Feature flags", description: "Turn platform features on and off", group: "Platform" },
  { key: "analytics.view", label: "View analytics", description: "Dashboards for players, trading and revenue", group: "Platform" },
  { key: "audit.view", label: "View audit log", description: "Read the record of every administrative action", group: "Platform" },
  { key: "backups.manage", label: "Backups", description: "Create, export, import and restore configuration", group: "Platform", sensitive: true },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

export type StaffRole = "owner" | "admin" | "developer" | "content" | "moderator";

export interface RoleDef {
  key: StaffRole;
  label: string;
  description: string;
  /** Base permissions. Owner is special-cased to "everything", always. */
  permissions: Permission[];
  /** Roles this role is allowed to create or edit. */
  canManage: StaffRole[];
}

export const ROLES: RoleDef[] = [
  {
    key: "owner",
    label: "Owner",
    description:
      "Full access to everything, including the team and security settings. Created manually — there is no sign-up.",
    permissions: ALL_PERMISSIONS,
    canManage: ["owner", "admin", "developer", "content", "moderator"],
  },
  {
    key: "admin",
    label: "Administrator",
    description:
      "Nearly every module, and can manage the team — but can never edit, demote or delete an Owner.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "security.manage"),
    canManage: ["admin", "developer", "content", "moderator"],
  },
  {
    key: "developer",
    label: "Developer",
    description:
      "Game configuration, assets, themes, integrations and feature flags. No team or security access.",
    permissions: [
      "game.config",
      "matches.control",
      "assets.manage",
      "themes.manage",
      "content.manage",
      "telegram.manage",
      "flags.manage",
      "analytics.view",
      "audit.view",
      "users.view",
    ],
    canManage: [],
  },
  {
    key: "content",
    label: "Content Manager",
    description: "Images, sounds, announcements, quests, NFTs and themes.",
    permissions: ["content.manage", "assets.manage", "themes.manage", "analytics.view", "users.view"],
    canManage: [],
  },
  {
    key: "moderator",
    label: "Moderator",
    description: "Players, reports, chat and Telegram moderation.",
    permissions: ["users.view", "users.moderate", "telegram.moderate", "analytics.view"],
    canManage: [],
  },
];

export const ROLE_MAP: Record<StaffRole, RoleDef> = Object.fromEntries(
  ROLES.map((r) => [r.key, r]),
) as Record<StaffRole, RoleDef>;

/**
 * A staff account as the UI sees it. The password hash and TOTP secret never
 * leave the server, so they are deliberately absent from this shape.
 */
export interface StaffAccount {
  id: string;
  username: string;
  displayName?: string;
  role: StaffRole;
  /** Permissions granted on top of the role. */
  extraPermissions: Permission[];
  /** Permissions revoked from the role — a deny always beats a grant. */
  deniedPermissions: Permission[];
  twoFactorEnabled: boolean;
  disabled: boolean;
  createdAt: number;
  createdBy?: string;
  lastLoginAt?: number;
  lastLoginIp?: string;
  /** Optional link to the staffer's player wallet, for cross-reference. */
  walletAddress?: string;
}

/** The signed-in staffer, as returned by the session endpoint. */
export interface StaffSessionInfo {
  account: StaffAccount;
  /** Fully resolved permission set — role, plus grants, minus denials. */
  permissions: Permission[];
  expiresAt: number;
}

/**
 * Resolve an account's effective permissions. Owner always holds everything
 * (so a mis-edit can never lock the platform out of its own controls); every
 * other role is base ∪ extra ∖ denied.
 */
export function effectivePermissions(account: {
  role: StaffRole;
  extraPermissions?: Permission[];
  deniedPermissions?: Permission[];
}): Permission[] {
  if (account.role === "owner") return [...ALL_PERMISSIONS];
  const base = new Set(ROLE_MAP[account.role]?.permissions ?? []);
  for (const p of account.extraPermissions ?? []) base.add(p);
  for (const p of account.deniedPermissions ?? []) base.delete(p);
  return [...base];
}

export function hasPermission(
  account: { role: StaffRole; extraPermissions?: Permission[]; deniedPermissions?: Permission[] },
  permission: Permission,
): boolean {
  if (account.role === "owner") return true;
  return effectivePermissions(account).includes(permission);
}

// ---------------------------------------------------------------- audit log

/**
 * One administrative action. Written for every mutation the Command Center
 * performs, with the before/after values so a bad change can be read back and
 * reversed by hand.
 */
export interface AuditEntry {
  id: string;
  at: number;
  /** Staff account id, or "system"/"admin-key" for non-account actors. */
  actorId: string;
  actorName: string;
  actorRole?: StaffRole;
  module: CcModule | "auth" | "system";
  /** Verb, e.g. "settings.update", "user.ban", "staff.create". */
  action: string;
  /** What was acted on — a user address, a flag key, a setting path. */
  target?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  note?: string;
}

// ------------------------------------------------------------ feature flags

export interface FeatureFlagDef {
  key: string;
  label: string;
  description: string;
  group: string;
  /** Value when nothing has been set in the database. */
  defaultValue: boolean;
}

/**
 * Platform features that can be switched off without a deploy. The registry is
 * the source of truth for the UI; stored values are a sparse override map, so
 * adding a flag here needs no migration.
 */
export const FEATURE_FLAGS: FeatureFlagDef[] = [
  { key: "pit", label: "The Pit", description: "The PvE arena as a whole", group: "Modes", defaultValue: true },
  { key: "pit_prediction", label: "Prediction Market", description: "Pit prediction pools and House Specials", group: "Modes", defaultValue: true },
  { key: "pit_trading", label: "Battle the Goon Squad", description: "The Pit's head-to-head trading pool", group: "Modes", defaultValue: true },
  { key: "flame_trial", label: "Flame Trial", description: "Solo objective mode in The Pit", group: "Modes", defaultValue: true },
  { key: "endurance", label: "Endurance", description: "The no-timer launchpad track", group: "Modes", defaultValue: true },
  { key: "goons", label: "Flame Goon Squad", description: "AI personalities and their commentary", group: "Modes", defaultValue: true },
  { key: "burgers", label: "BURGERS economy", description: "Earning and spending $BURG", group: "Economy", defaultValue: true },
  { key: "jackpot", label: "Weekly Jackpot", description: "The XP-driven weekly prize pool", group: "Economy", defaultValue: true },
  { key: "loot_boxes", label: "Recruit Coolers", description: "Loot boxes (not yet player-facing)", group: "Economy", defaultValue: false },
  { key: "nfts", label: "NFTs", description: "NFT collections and drops (not yet player-facing)", group: "Economy", defaultValue: false },
  { key: "telegram", label: "Telegram companion", description: "The Pit Boss bot and its notifications", group: "Integrations", defaultValue: true },
  { key: "seasonal_theme", label: "Seasonal themes", description: "Let a scheduled theme reskin the site", group: "Presentation", defaultValue: false },
  { key: "maintenance", label: "Maintenance mode", description: "Show the maintenance screen to players", group: "Platform", defaultValue: false },
];

export const FEATURE_FLAG_MAP: Record<string, FeatureFlagDef> = Object.fromEntries(
  FEATURE_FLAGS.map((f) => [f.key, f]),
);

/** Resolve a flag against its stored overrides, falling back to the default. */
export function flagEnabled(overrides: Record<string, boolean> | undefined, key: string): boolean {
  const stored = overrides?.[key];
  if (typeof stored === "boolean") return stored;
  return FEATURE_FLAG_MAP[key]?.defaultValue ?? false;
}

/** Every flag resolved to a concrete value — what the client is served. */
export function resolveFlags(overrides: Record<string, boolean> | undefined): Record<string, boolean> {
  return Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, flagEnabled(overrides, f.key)]));
}

// ------------------------------------------------------------ global search

export interface SearchHit {
  /** What kind of thing this is — drives the icon and the destination. */
  kind: "user" | "coin" | "round" | "setting" | "flag" | "staff" | "audit" | "module";
  id: string;
  title: string;
  subtitle?: string;
  /** Where clicking it goes: a Command Center module, optionally deep-linked. */
  module: CcModule;
  href?: string;
}
