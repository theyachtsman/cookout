/**
 * The Media Library — central asset storage for the Command Center.
 *
 * Assets live on disk beside the API and are served from a stable public path,
 * so a logo or a theme background is a URL that survives an edit rather than a
 * data URL copied into every record that uses it. Coin art and avatars keep
 * their existing inline path (they're per-record, user-supplied, and already
 * downscaled client-side); the library is for assets the team manages.
 */

/** What an asset is used for. Drives the default folder and the pickers. */
export type MediaKind = "image" | "audio" | "video" | "other";

export interface MediaAsset {
  id: string;
  /** Stored filename, `<id>.<ext>` — the on-disk name and the public path. */
  filename: string;
  /** What it was called when uploaded, for humans. */
  originalName: string;
  kind: MediaKind;
  mime: string;
  /** Bytes. */
  size: number;
  /** Pixel dimensions when we could read them (PNG, JPEG, GIF, WebP). */
  width?: number;
  height?: number;
  /** Organisational folder, e.g. "branding", "themes/halloween", "audio/pit". */
  folder: string;
  tags: string[];
  uploadedAt: number;
  uploadedBy: string;
  /** SHA-256 of the bytes — powers duplicate detection on upload. */
  checksum: string;
}

/** Public URL path for an asset, relative to the API origin. */
export function mediaPath(asset: Pick<MediaAsset, "filename">): string {
  return `/media/${asset.filename}`;
}

/** Extensions we accept, by MIME type. Anything absent is rejected: an ops
 *  tool should not be a general file host. */
export const MEDIA_TYPES: Record<string, { ext: string; kind: MediaKind }> = {
  "image/png": { ext: "png", kind: "image" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "image/svg+xml": { ext: "svg", kind: "image" },
  "image/x-icon": { ext: "ico", kind: "image" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};

/** Hard ceiling per asset (bytes). Generous for audio, sane for a disk store. */
export const MEDIA_MAX_BYTES = 12 * 1024 * 1024;

/** Folders the Command Center suggests. Free-text is still allowed. */
export const MEDIA_FOLDERS = [
  "branding",
  "themes",
  "audio",
  "characters",
  "nft",
  "marketing",
  "misc",
] as const;

/**
 * Where a branded asset is used. Each slot holds a media asset id (or a URL),
 * so replacing the site logo is a reassignment, not a deploy.
 */
export type BrandingSlot =
  | "logo"
  | "logoMark"
  | "icon"
  | "favicon"
  | "appleIcon"
  | "ogImage"
  | "splash"
  | "loading"
  | "background";

export interface BrandingSlotDef {
  key: BrandingSlot;
  label: string;
  description: string;
  /** Guidance shown in the picker — not enforced, since art direction isn't
   *  something a validator should have opinions about. */
  recommended: string;
}

export const BRANDING_SLOTS: BrandingSlotDef[] = [
  { key: "logo", label: "Primary logo", description: "The full wordmark in the top nav", recommended: "SVG or PNG, ~640×160" },
  { key: "logoMark", label: "Logo mark", description: "The compact mark used when space is tight", recommended: "Square, ~256×256" },
  { key: "icon", label: "App icon", description: "Browser tab and PWA icon", recommended: "PNG 512×512" },
  { key: "favicon", label: "Favicon", description: "Small tab icon", recommended: "ICO or PNG 32×32" },
  { key: "appleIcon", label: "Apple touch icon", description: "iOS home-screen icon", recommended: "PNG 180×180" },
  { key: "ogImage", label: "Open Graph image", description: "The card shown when a link is shared", recommended: "PNG 1200×630" },
  { key: "splash", label: "Splash screen", description: "The pre-sign-in landing visual", recommended: "Wide, ≥1920px" },
  { key: "loading", label: "Loading screen", description: "Shown while the app boots", recommended: "Wide, ≥1920px" },
  { key: "background", label: "Site background", description: "Sits behind the whole app", recommended: "Tileable or ≥2560px" },
];

/** Brand colours, as CSS values. Empty string = use the built-in default. */
export interface BrandColors {
  accent: string;
  accentText: string;
  background: string;
  surface: string;
  positive: string;
  negative: string;
  warning: string;
}

export const DEFAULT_BRAND_COLORS: BrandColors = {
  accent: "#a3e635",
  accentText: "#09090b",
  background: "#09090b",
  surface: "#18181b",
  positive: "#34d399",
  negative: "#f87171",
  warning: "#fbbf24",
};

export interface BrandingSettings {
  /** Slot → media asset id, or "" when the built-in default is in use. */
  assets: Record<BrandingSlot, string>;
  colors: BrandColors;
  /** Site name, used in titles and share cards. */
  siteName: string;
  tagline: string;
}

export function freshBrandingSettings(): BrandingSettings {
  return {
    assets: Object.fromEntries(BRANDING_SLOTS.map((s) => [s.key, ""])) as Record<BrandingSlot, string>,
    colors: { ...DEFAULT_BRAND_COLORS },
    siteName: "The Cookout",
    tagline: "The live trading battleground",
  };
}
