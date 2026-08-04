import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEDIA_MAX_BYTES,
  activeTheme,
  freshTheme,
  themeWindowLabel,
} from "@cookout/shared";
import { MediaService, MediaError } from "./media.js";
import { Store } from "./store.js";

/** A 1×1 PNG, as a data URL — smallest thing with a real header to parse. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MP3 = `data:audio/mpeg;base64,${Buffer.from("ID3fake-audio-bytes").toString("base64")}`;

function setup() {
  const store = new Store();
  const dir = mkdtempSync(join(tmpdir(), "cookout-media-"));
  return { store, media: new MediaService(store, dir), dir };
}

test("upload: writes bytes to disk and records metadata", () => {
  const { store, media, dir } = setup();
  const { asset, duplicate } = media.upload({
    dataUrl: PNG_1X1,
    originalName: "logo.png",
    folder: "Branding",
    tags: ["Logo", "primary"],
    uploadedBy: "owner",
  });
  assert.equal(duplicate, false);
  assert.equal(asset.mime, "image/png");
  assert.equal(asset.kind, "image");
  assert.equal(asset.originalName, "logo.png");
  assert.equal(asset.folder, "branding", "folders are normalised");
  assert.deepEqual(asset.tags, ["logo", "primary"]);
  assert.equal(asset.width, 1, "PNG dimensions are read from the header");
  assert.equal(asset.height, 1);
  assert.ok(asset.size > 0);
  assert.equal(store.media.get(asset.id)?.id, asset.id);
  assert.ok(readdirSync(dir).includes(asset.filename), "the file is on disk");
});

test("upload: identical bytes return the existing asset instead of a copy", () => {
  const { media, dir } = setup();
  const first = media.upload({ dataUrl: PNG_1X1, uploadedBy: "owner" });
  const second = media.upload({ dataUrl: PNG_1X1, uploadedBy: "owner" });
  assert.equal(second.duplicate, true);
  assert.equal(second.asset.id, first.asset.id);
  assert.equal(readdirSync(dir).length, 1, "only one file was written");
});

test("upload: rejects unsupported types, empty files and oversized ones", () => {
  const { media } = setup();
  assert.throws(() => media.upload({ dataUrl: "not-a-data-url", uploadedBy: "o" }), /base64 data URL/);
  assert.throws(
    () => media.upload({ dataUrl: "data:application/x-sh;base64,ZWNobyBoaQ==", uploadedBy: "o" }),
    /isn't an accepted media type/,
  );
  assert.throws(() => media.upload({ dataUrl: "data:image/png;base64,", uploadedBy: "o" }), /base64 data URL/);
  const huge = `data:image/png;base64,${Buffer.alloc(MEDIA_MAX_BYTES + 1024).toString("base64")}`;
  assert.throws(() => media.upload({ dataUrl: huge, uploadedBy: "o" }), /too large/);
});

test("pathFor refuses to escape the media directory", () => {
  const { media, dir } = setup();
  // Something an attacker would aim at, planted outside the media dir.
  writeFileSync(join(dir, "..", "secret.txt"), "top secret");
  for (const attempt of [
    "../secret.txt",
    "..%2Fsecret.txt",
    "../../etc/passwd",
    "/etc/passwd",
    "sub/dir/file.png",
    ".env",
    "",
  ])
    assert.equal(media.pathFor(attempt), null, `refused: ${attempt}`);

  // A real asset still resolves.
  const { asset } = media.upload({ dataUrl: PNG_1X1, uploadedBy: "o" });
  assert.ok(media.pathFor(asset.filename), "a genuine filename resolves");
  assert.equal(media.pathFor("does-not-exist.png"), null);
});

test("replace: keeps the id so every reference follows the new bytes", () => {
  const { store, media } = setup();
  const { asset } = media.upload({ dataUrl: PNG_1X1, uploadedBy: "o" });
  const oldFilename = asset.filename;
  store.settings.branding.assets.logo = asset.id;

  const replaced = media.replace(asset.id, MP3);
  assert.equal(replaced.id, asset.id, "the id is stable");
  assert.equal(replaced.mime, "audio/mpeg");
  assert.equal(replaced.kind, "audio");
  assert.notEqual(replaced.filename, oldFilename, "and the file behind it changed");
  assert.equal(store.settings.branding.assets.logo, asset.id, "the branding slot still points at it");
  assert.equal(media.pathFor(oldFilename), null, "the old file is gone");
  assert.equal(media.list().length, 1, "no orphan record was left behind");
});

test("delete: removes the file and reports what still referenced it", () => {
  const { store, media } = setup();
  const { asset } = media.upload({ dataUrl: PNG_1X1, uploadedBy: "o" });
  store.settings.branding.assets.logo = asset.id;
  const theme = freshTheme("t1", "Halloween");
  theme.assets.background = asset.id;
  store.settings.themes.themes.t1 = theme;
  store.settings.audio.cues["pit.win"] = asset.id;

  const refs = media.referencesTo(asset.id);
  assert.equal(refs.length, 3);
  assert.ok(refs.some((r) => r.includes("Branding")));
  assert.ok(refs.some((r) => r.includes("Halloween")));
  assert.ok(refs.some((r) => r.includes("Audio")));

  const removed = media.remove(asset.id);
  assert.equal(removed.references.length, 3, "the operator is told what broke");
  assert.equal(store.media.has(asset.id), false);
  assert.equal(media.list().length, 0);
});

test("reconcile drops metadata whose file has vanished", () => {
  const { store, media, dir } = setup();
  const { asset } = media.upload({ dataUrl: PNG_1X1, uploadedBy: "o" });
  assert.equal(media.reconcile().length, 0, "nothing to prune when the file is there");
  // Simulate a file removed out from under us (manual delete, partial restore).
  const path = join(dir, asset.filename);
  assert.ok(existsSync(path));
  unlinkSync(path);
  assert.deepEqual(media.reconcile(), [asset.id]);
  assert.equal(store.media.size, 0, "the library never advertises a broken asset");
});

test("media metadata survives a snapshot round-trip", () => {
  const { store, media } = setup();
  const { asset } = media.upload({ dataUrl: PNG_1X1, folder: "themes/xmas", uploadedBy: "owner" });
  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.media.get(asset.id)?.folder, "themes/xmas");
  assert.equal(restored.media.get(asset.id)?.checksum, asset.checksum);
});

// ------------------------------------------------------------------- themes

test("theme scheduling: a window activates, a pin beats the schedule", () => {
  const store = new Store();
  const t = store.settings.themes;
  t.enabled = true;
  const day = 86_400_000;
  const now = 1_800_000_000_000;

  const halloween = freshTheme("h", "Halloween");
  halloween.startsAt = now - day;
  halloween.endsAt = now + day;
  const christmas = freshTheme("c", "Christmas");
  christmas.startsAt = now + 10 * day;
  t.themes = { h: halloween, c: christmas };

  assert.equal(activeTheme(t, now)?.id, "h", "the theme whose window contains now");
  assert.equal(activeTheme(t, now + 5 * day)?.id, undefined, "nothing between windows");
  assert.equal(activeTheme(t, now + 11 * day)?.id, "c");

  // A manual pin always wins.
  t.activeThemeId = "c";
  assert.equal(activeTheme(t, now)?.id, "c");
  t.activeThemeId = "";

  // Archived themes never activate…
  halloween.archived = true;
  assert.equal(activeTheme(t, now), null);
  halloween.archived = false;

  // …and the master switch turns the whole thing off.
  t.enabled = false;
  assert.equal(activeTheme(t, now), null);
});

test("theme window labels read sensibly", () => {
  const now = 1_800_000_000_000;
  const manual = freshTheme("m", "Manual");
  assert.equal(themeWindowLabel(manual, now), "Manual only");
  const archived = freshTheme("a", "Old");
  archived.archived = true;
  assert.equal(themeWindowLabel(archived, now), "Archived");
  const running = freshTheme("r", "Now");
  running.startsAt = now - 1000;
  assert.match(themeWindowLabel(running, now), /Running since/);
  const upcoming = freshTheme("u", "Soon");
  upcoming.startsAt = now + 1000;
  assert.match(themeWindowLabel(upcoming, now), /Scheduled/);
});

test("MediaError carries a status the route layer can use", () => {
  const { media } = setup();
  try {
    media.remove("nope");
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof MediaError);
    assert.equal((e as MediaError).status, 404);
  }
});
