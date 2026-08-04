/**
 * Media storage on local disk.
 *
 * Files live under MEDIA_DIR (default `<repo>/data/media`, same shape as the
 * file snapshot) and are served read-only from `/media/<filename>`. Metadata
 * lives in the store so it persists with everything else; the disk holds only
 * bytes, named by asset id, so a stray file can never be mistaken for an asset
 * the platform knows about and vice versa.
 *
 * Uploads arrive as data URLs — the same shape the existing image pickers
 * already produce — which keeps the client simple and avoids adding a
 * multipart dependency for a handful of admin uploads a week.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import {
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  type MediaAsset,
  type MediaKind,
} from "@cookout/shared";
import type { Store } from "./store.js";

export class MediaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class MediaService {
  readonly dir: string;

  constructor(
    private store: Store,
    dir = process.env.MEDIA_DIR ?? new URL("../data/media", import.meta.url).pathname,
  ) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  list(): MediaAsset[] {
    return [...this.store.media.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  get(id: string): MediaAsset | undefined {
    return this.store.media.get(id);
  }

  /**
   * Resolve a stored filename to a path on disk, refusing anything that tries
   * to escape the media directory. The filename comes from a URL, so this is
   * the boundary that has to hold: `..%2F..%2Fetc%2Fpasswd` decodes to a real
   * traversal, and only an explicit containment check stops it.
   */
  pathFor(filename: string): string | null {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename)) return null;
    const full = resolve(join(this.dir, normalize(filename)));
    if (full !== join(this.dir, filename)) return null;
    return existsSync(full) ? full : null;
  }

  /**
   * Store a data-URL upload. Returns the existing asset when the exact same
   * bytes are already in the library — re-uploading a logo shouldn't quietly
   * fill the disk with copies of it.
   */
  upload(input: {
    dataUrl: string;
    originalName?: string;
    folder?: string;
    tags?: string[];
    uploadedBy: string;
  }): { asset: MediaAsset; duplicate: boolean } {
    const match = /^data:([\w.+/-]+);base64,(.+)$/.exec(input.dataUrl.trim());
    if (!match) throw new MediaError(400, "expected a base64 data URL");
    const mime = match[1]!.toLowerCase();
    const type = MEDIA_TYPES[mime];
    if (!type) throw new MediaError(400, `${mime} isn't an accepted media type`);

    const bytes = Buffer.from(match[2]!, "base64");
    if (bytes.length === 0) throw new MediaError(400, "that file is empty");
    if (bytes.length > MEDIA_MAX_BYTES)
      throw new MediaError(
        413,
        `too large: ${(bytes.length / 1_048_576).toFixed(1)} MB, limit is ${MEDIA_MAX_BYTES / 1_048_576} MB`,
      );

    const checksum = createHash("sha256").update(bytes).digest("hex");
    const existing = this.list().find((a) => a.checksum === checksum);
    if (existing) return { asset: existing, duplicate: true };

    const id = this.store.id();
    const filename = `${id}.${type.ext}`;
    // Write to a temp name and rename, so a crash mid-write can never leave a
    // truncated file being served as a real asset.
    const tmp = join(this.dir, `${filename}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, join(this.dir, filename));

    const dims = imageSize(bytes, mime);
    const asset: MediaAsset = {
      id,
      filename,
      originalName: (input.originalName ?? filename).slice(0, 120),
      kind: type.kind as MediaKind,
      mime,
      size: bytes.length,
      width: dims?.width,
      height: dims?.height,
      folder: sanitizeFolder(input.folder),
      tags: sanitizeTags(input.tags),
      uploadedAt: Date.now(),
      uploadedBy: input.uploadedBy,
      checksum,
    };
    this.store.media.set(asset.id, asset);
    return { asset, duplicate: false };
  }

  update(id: string, patch: { folder?: string; tags?: string[]; originalName?: string }): MediaAsset {
    const asset = this.store.media.get(id);
    if (!asset) throw new MediaError(404, "no such asset");
    if (patch.folder !== undefined) asset.folder = sanitizeFolder(patch.folder);
    if (patch.tags !== undefined) asset.tags = sanitizeTags(patch.tags);
    if (patch.originalName !== undefined) asset.originalName = patch.originalName.slice(0, 120);
    return asset;
  }

  /**
   * Replace an asset's bytes in place, keeping its id — so every reference to
   * it (a branding slot, a theme, a sound cue) picks up the new file without
   * being repointed. The extension can change, so the filename may too.
   */
  replace(id: string, dataUrl: string): MediaAsset {
    const asset = this.store.media.get(id);
    if (!asset) throw new MediaError(404, "no such asset");
    const fresh = this.upload({ dataUrl, uploadedBy: asset.uploadedBy, folder: asset.folder });
    // upload() stored it under a new id; move those bytes onto this asset and
    // drop the temporary record so the library doesn't show both.
    if (!fresh.duplicate) {
      const oldPath = this.pathFor(asset.filename);
      if (oldPath) unlinkSync(oldPath);
      asset.filename = fresh.asset.filename;
      asset.mime = fresh.asset.mime;
      asset.kind = fresh.asset.kind;
      asset.size = fresh.asset.size;
      asset.width = fresh.asset.width;
      asset.height = fresh.asset.height;
      asset.checksum = fresh.asset.checksum;
      this.store.media.delete(fresh.asset.id);
    }
    return asset;
  }

  /** Delete an asset and its file. Reports what still points at it. */
  remove(id: string): { asset: MediaAsset; references: string[] } {
    const asset = this.store.media.get(id);
    if (!asset) throw new MediaError(404, "no such asset");
    const references = this.referencesTo(id);
    const path = this.pathFor(asset.filename);
    if (path) unlinkSync(path);
    this.store.media.delete(id);
    return { asset, references };
  }

  /**
   * Everywhere an asset is currently used. Deleting one that's in use is
   * allowed — the slot falls back to its built-in default — but the operator
   * should be told, not surprised.
   */
  referencesTo(id: string): string[] {
    const refs: string[] = [];
    for (const [slot, value] of Object.entries(this.store.settings.branding.assets))
      if (value === id) refs.push(`Branding · ${slot}`);
    for (const theme of Object.values(this.store.settings.themes.themes)) {
      for (const [slot, value] of Object.entries(theme.assets ?? {}))
        if (value === id) refs.push(`Theme "${theme.name}" · ${slot}`);
    }
    for (const [cue, value] of Object.entries(this.store.settings.audio.cues))
      if (value === id) refs.push(`Audio · ${cue}`);
    return refs;
  }

  /** Bytes on disk across every known asset. */
  totalBytes(): number {
    return this.list().reduce((sum, a) => sum + a.size, 0);
  }

  /**
   * Drop metadata rows whose file has vanished (a manual delete, a restore from
   * an older backup). Called at boot so the library never advertises a broken
   * asset. Returns the ids that were pruned.
   */
  reconcile(): string[] {
    const missing: string[] = [];
    for (const asset of this.list())
      if (!this.pathFor(asset.filename)) {
        missing.push(asset.id);
        this.store.media.delete(asset.id);
      }
    return missing;
  }
}

function sanitizeFolder(folder: string | undefined): string {
  const clean = String(folder ?? "misc")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .slice(0, 60);
  return clean || "misc";
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .map((t) => String(t).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24))
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

/**
 * Read pixel dimensions straight out of the file header. Only the formats a
 * few bytes can answer for — anything else simply has no dimensions recorded,
 * which is better than pulling in an image library for a display nicety.
 */
function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length > 24)
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === "image/gif" && buf.length > 10)
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1]!;
        // SOF0–SOF15, excluding the non-frame markers in that range.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (mime === "image/webp" && buf.length > 30 && buf.toString("ascii", 12, 16) === "VP8X")
      return {
        width: 1 + (buf.readUIntLE(24, 3) & 0xffffff),
        height: 1 + (buf.readUIntLE(27, 3) & 0xffffff),
      };
  } catch {
    /* a malformed header just means no dimensions */
  }
  return null;
}

/** Read an asset's bytes for serving. */
export function readAsset(path: string): Buffer {
  return readFileSync(path);
}
