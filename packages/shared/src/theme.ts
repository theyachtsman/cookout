/**
 * Theme Studio and the Audio Manager.
 *
 * A theme is a set of overrides — colours, images, a few flourishes — layered
 * over the site's built-in look. Nothing here changes gameplay; a theme that
 * fails to load leaves the default styling exactly as it is, which is the
 * property that makes scheduling one safe.
 *
 * Themes are stored as data and applied as CSS custom properties, so a
 * seasonal reskin is a database row and a scheduled window, not a deploy.
 */
import { DEFAULT_BRAND_COLORS, type BrandColors } from "./media.js";

/** Image slots a theme can override. Each holds a media asset id. */
export type ThemeAssetSlot =
  | "background"
  | "heroBanner"
  | "loading"
  | "panelTexture"
  | "logo"
  | "mascot"
  | "goonSkin";

export interface ThemeAssetSlotDef {
  key: ThemeAssetSlot;
  label: string;
  description: string;
}

export const THEME_ASSET_SLOTS: ThemeAssetSlotDef[] = [
  { key: "background", label: "Site background", description: "Behind the whole app" },
  { key: "heroBanner", label: "Hero banner", description: "Behind the Cook Out featured slot" },
  { key: "loading", label: "Loading screen", description: "Shown while the app boots" },
  { key: "panelTexture", label: "Panel texture", description: "Subtle overlay on cards and panels" },
  { key: "logo", label: "Seasonal logo", description: "Replaces the wordmark for the season" },
  { key: "mascot", label: "Ghost mascot skin", description: "The mascot's seasonal outfit" },
  { key: "goonSkin", label: "Goon Squad skin", description: "Seasonal art for the Flame Goon Squad" },
];

/** Optional visual flourishes. Off by default — a theme adds, never subtracts. */
export interface ThemeEffects {
  /** Falling particles (snow, leaves, embers…). */
  particles: "none" | "snow" | "leaves" | "embers" | "confetti" | "rain";
  /** Particle density, 0..1. */
  particleIntensity: number;
  /** Corner radius scale applied to panels and buttons, 0.5..2. */
  radiusScale: number;
  /** Add a glow to accented elements. */
  glow: boolean;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: BrandColors;
  /** Slot → media asset id. Absent or "" = no override for that slot. */
  assets: Partial<Record<ThemeAssetSlot, string>>;
  effects: ThemeEffects;
  /** Sound cue overrides: cue key → media asset id. */
  audio: Record<string, string>;
  /** Scheduled window, epoch ms. Both absent = manual activation only. */
  startsAt?: number;
  endsAt?: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeSettings {
  /** Every theme, keyed by id. */
  themes: Record<string, Theme>;
  /** Manually pinned theme id. Beats any schedule; "" = follow the schedule. */
  activeThemeId: string;
  /** Master switch — mirrors the `seasonal_theme` feature flag. */
  enabled: boolean;
}

export function freshThemeSettings(): ThemeSettings {
  return { themes: {}, activeThemeId: "", enabled: false };
}

export function freshTheme(id: string, name: string, now = Date.now()): Theme {
  return {
    id,
    name,
    description: "",
    colors: { ...DEFAULT_BRAND_COLORS },
    assets: {},
    effects: { particles: "none", particleIntensity: 0.4, radiusScale: 1, glow: false },
    audio: {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Which theme is live right now.
 *
 * A manual pin always wins, so an operator previewing or forcing a theme is
 * never overridden by a schedule. Otherwise the earliest-starting scheduled
 * theme whose window contains `now` applies. Archived themes never activate.
 */
export function activeTheme(settings: ThemeSettings, now = Date.now()): Theme | null {
  if (!settings.enabled) return null;
  const all = Object.values(settings.themes).filter((t) => !t.archived);
  if (settings.activeThemeId) {
    return all.find((t) => t.id === settings.activeThemeId) ?? null;
  }
  const scheduled = all
    .filter((t) => t.startsAt !== undefined && now >= t.startsAt && (t.endsAt === undefined || now < t.endsAt))
    .sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0));
  return scheduled[0] ?? null;
}

/** A theme's window in words, for the scheduling UI. */
export function themeWindowLabel(theme: Theme, now = Date.now()): string {
  if (theme.archived) return "Archived";
  if (theme.startsAt === undefined) return "Manual only";
  const start = new Date(theme.startsAt).toLocaleDateString();
  const end = theme.endsAt ? new Date(theme.endsAt).toLocaleDateString() : "no end";
  if (now < theme.startsAt) return `Scheduled ${start} → ${end}`;
  if (theme.endsAt !== undefined && now >= theme.endsAt) return `Ended ${end}`;
  return `Running since ${start} → ${end}`;
}

// ------------------------------------------------------------------- audio

/** A sound the platform plays. The cue key is what gameplay refers to. */
export interface SoundCueDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

/**
 * Every configurable sound. The keys mirror what the client already plays;
 * an override points a cue at a media asset, and anything not overridden keeps
 * its built-in synthesised sound.
 */
export const SOUND_CUES: SoundCueDef[] = [
  { key: "trade.buy", label: "Buy", description: "Someone buys", group: "Trading" },
  { key: "trade.sell", label: "Sell", description: "Someone sells", group: "Trading" },
  { key: "trade.whale", label: "Whale", description: "A whale-sized trade lands", group: "Trading" },
  { key: "trade.ath", label: "New ATH", description: "Market cap sets a record", group: "Trading" },
  { key: "round.launch", label: "Launch", description: "A round goes live", group: "Match" },
  { key: "round.graduated", label: "Served up", description: "A coin completes its bond", group: "Match" },
  { key: "round.rug", label: "Rug", description: "A rug is detected", group: "Match" },
  { key: "round.over", label: "Round over", description: "The match ends", group: "Match" },
  { key: "round.milestone", label: "Milestone", description: "A market-cap milestone", group: "Match" },
  { key: "countdown.tick", label: "Countdown tick", description: "Final-seconds tick", group: "Match" },
  { key: "countdown.cook", label: "COOK!", description: "The open", group: "Match" },
  { key: "pit.win", label: "Pit win", description: "You win a Pit match", group: "The Pit" },
  { key: "pit.lose", label: "Pit loss", description: "You lose a Pit match", group: "The Pit" },
  { key: "pit.goon", label: "Goon moment", description: "A Goon Squad beat", group: "The Pit" },
  { key: "xp.gain", label: "XP earned", description: "The +XP drop-in", group: "Progression" },
  { key: "xp.levelup", label: "Level up", description: "A new level", group: "Progression" },
  { key: "achievement.unlock", label: "Achievement", description: "A badge unlocks", group: "Progression" },
  { key: "burger.earn", label: "BURGERS earned", description: "The 🍔 toast", group: "Progression" },
  { key: "lootbox.open", label: "Recruit Cooler", description: "A loot box opens", group: "Progression" },
  { key: "ui.click", label: "Click", description: "Buttons and tabs", group: "Interface" },
  { key: "ui.tab", label: "Tab change", description: "Switching view", group: "Interface" },
  { key: "ui.error", label: "Error", description: "Something was refused", group: "Interface" },
  { key: "notify.ping", label: "Notification", description: "A mention or alert", group: "Interface" },
];

export interface AudioSettings {
  /** Cue key → media asset id. Absent = the built-in sound. */
  cues: Record<string, string>;
  /** Master volume multiplier applied on top of the player's own setting. */
  masterVolume: number;
  /** Per-group volume multipliers, keyed by SoundCueDef.group. */
  groupVolume: Record<string, number>;
}

export function freshAudioSettings(): AudioSettings {
  return {
    cues: {},
    masterVolume: 1,
    groupVolume: Object.fromEntries([...new Set(SOUND_CUES.map((c) => c.group))].map((g) => [g, 1])),
  };
}
