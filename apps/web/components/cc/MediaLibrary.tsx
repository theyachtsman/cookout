"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEDIA_FOLDERS,
  MEDIA_MAX_BYTES,
  type MediaAsset,
  type MediaKind,
} from "@cookout/shared";
import { apiUrl } from "../../lib/api";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/** Absolute URL for a stored asset. */
export function assetUrl(asset: Pick<MediaAsset, "filename">): string {
  return `${apiUrl()}/media/${asset.filename}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** Read a File into the base64 data URL the upload endpoint expects. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("couldn't read that file"));
    reader.readAsDataURL(file);
  });
}

interface MediaData {
  assets: MediaAsset[];
  folders: string[];
  tags: string[];
  totalBytes: number;
  count: number;
}

/**
 * The Media Library — central storage for everything the team uploads.
 *
 * Assets are stored by id on the API's disk and served from a stable URL, so
 * replacing a file updates every place that uses it rather than needing each
 * reference repointed.
 */
export function MediaModule() {
  const [data, setData] = useState<MediaData | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [kind, setKind] = useState<MediaKind | "">("");
  const [uploadFolder, setUploadFolder] = useState("misc");
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (folder) params.set("folder", folder);
    if (kind) params.set("kind", kind);
    cc<MediaData>(`/api/cc/media?${params}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [q, folder, kind]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    setNote("");
    let added = 0;
    let dupes = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > MEDIA_MAX_BYTES) {
          setError(`${file.name} is ${bytes(file.size)} — the limit is ${bytes(MEDIA_MAX_BYTES)}`);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        const r = await cc<{ duplicate: boolean }>("/api/cc/media", {
          body: { dataUrl, originalName: file.name, folder: uploadFolder },
        });
        if (r.duplicate) dupes++;
        else added++;
      }
      setNote(
        [added && `${added} uploaded`, dupes && `${dupes} already in the library`]
          .filter(Boolean)
          .join(" · ") || "Nothing to do",
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Upload"
        subtitle={`Images, audio and video up to ${bytes(MEDIA_MAX_BYTES)}. Identical files are recognised and never stored twice.`}
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className="cursor-pointer rounded-2xl border-2 border-dashed border-zinc-700 p-6 text-center transition hover:border-lime-400/50 hover:bg-lime-400/[0.03]"
        >
          <div className="text-2xl">📁</div>
          <div className="mt-1 text-sm font-black text-zinc-200">
            {busy ? "Uploading…" : "Drop files here, or click to choose"}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            Uploading into <span className="font-mono text-zinc-300">{uploadFolder}</span>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">Folder:</span>
          {MEDIA_FOLDERS.map((f) => (
            <button
              key={f}
              onClick={() => setUploadFolder(f)}
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                uploadFolder === f ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {f}
            </button>
          ))}
          <input
            value={uploadFolder}
            onChange={(e) => setUploadFolder(e.target.value)}
            className="w-32 rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] outline-none ring-1 ring-white/10"
          />
        </div>
      </Panel>

      <Panel
        title="Library"
        subtitle={data ? `${data.count} assets · ${bytes(data.totalBytes)} on disk` : "Loading…"}
        action={
          <div className="flex flex-wrap gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MediaKind | "")}
              className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
            >
              <option value="">All types</option>
              <option value="image">Images</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
            >
              <option value="">All folders</option>
              {data?.folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, folder, tag…"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
            />
          </div>
        }
      >
        {!data?.assets.length ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            {data ? "Nothing matches." : "Loading…"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.assets.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="group overflow-hidden rounded-xl bg-zinc-950/60 text-left ring-1 ring-white/10 transition hover:ring-lime-400/40"
              >
                <AssetPreview asset={a} />
                <div className="p-2">
                  <div className="truncate text-[11px] font-bold text-zinc-200">{a.originalName}</div>
                  <div className="truncate font-mono text-[10px] text-zinc-600">
                    {a.folder} · {bytes(a.size)}
                    {a.width ? ` · ${a.width}×${a.height}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {selected && (
        <AssetDetail
          asset={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            setSelected(null);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

export function AssetPreview({ asset, className = "" }: { asset: MediaAsset; className?: string }) {
  if (asset.kind === "image")
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assetUrl(asset)}
        alt={asset.originalName}
        className={`h-24 w-full bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain ${className}`}
      />
    );
  return (
    <div className={`flex h-24 w-full items-center justify-center bg-zinc-900 text-3xl ${className}`}>
      {asset.kind === "audio" ? "🔊" : asset.kind === "video" ? "🎬" : "📄"}
    </div>
  );
}

function AssetDetail({
  asset,
  onClose,
  onChanged,
  onError,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [folder, setFolder] = useState(asset.folder);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [name, setName] = useState(asset.originalName);
  const [refs, setRefs] = useState<string[] | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cc<{ references: string[] }>(`/api/cc/media/${asset.id}/references`)
      .then((d) => setRefs(d.references))
      .catch(() => setRefs([]));
  }, [asset.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-zinc-950 p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-black text-zinc-50">{asset.originalName}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-white/10">
          {asset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(asset)} alt="" className="max-h-64 w-full object-contain" />
          ) : asset.kind === "audio" ? (
            <audio controls src={assetUrl(asset)} className="w-full" />
          ) : (
            <div className="p-6 text-center text-3xl">🎬</div>
          )}
        </div>

        <div className="mt-3 space-y-2 text-xs">
          <div className="font-mono text-[11px] text-zinc-500">
            {asset.mime} · {bytes(asset.size)}
            {asset.width ? ` · ${asset.width}×${asset.height}` : ""} ·{" "}
            {new Date(asset.uploadedAt).toLocaleString()} · by {asset.uploadedBy}
          </div>
          <div className="break-all rounded-lg bg-zinc-900 p-2 font-mono text-[10px] text-lime-300">
            {assetUrl(asset)}
          </div>

          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 text-sm outline-none ring-1 ring-white/10"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Folder</span>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Tags (comma separated)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 text-sm outline-none ring-1 ring-white/10"
            />
          </label>

          {refs && refs.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-200">
              <b>In use by:</b> {refs.join(", ")}. Replacing swaps the file everywhere; deleting
              falls those back to their defaults.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() =>
              void cc(`/api/cc/media/${asset.id}`, {
                method: "PATCH",
                body: { folder, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), originalName: name },
              })
                .then(onChanged)
                .catch((e) => onError((e as Error).message))
            }
            className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Save
          </button>
          <button
            onClick={() => replaceInput.current?.click()}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
          >
            Replace file
          </button>
          <input
            ref={replaceInput}
            type="file"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const dataUrl = await fileToDataUrl(file);
                await cc(`/api/cc/media/${asset.id}/replace`, { body: { dataUrl } });
                onChanged();
              } catch (err) {
                onError((err as Error).message);
              }
            }}
          />
          <button
            onClick={() => {
              const warning = refs?.length
                ? `Delete "${asset.originalName}"? It's still used by: ${refs.join(", ")}.`
                : `Delete "${asset.originalName}"?`;
              if (!confirm(warning)) return;
              void cc(`/api/cc/media/${asset.id}`, { method: "DELETE" })
                .then(onChanged)
                .catch((e) => onError((e as Error).message));
            }}
            className="ml-auto rounded-lg bg-red-500/15 px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/25"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A reusable "pick an asset" control, used by Branding, Theme Studio and the
 * Audio Manager so all three share one picker rather than three near-copies.
 */
export function AssetPicker({
  value,
  kind,
  onPick,
  label,
  hint,
}: {
  value: string;
  kind?: MediaKind;
  onPick: (id: string) => void;
  label: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const current = assets.find((a) => a.id === value);

  useEffect(() => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    cc<{ assets: MediaAsset[] }>(`/api/cc/media?${params}`)
      .then((d) => setAssets(d.assets))
      .catch(() => {});
  }, [kind, open]);

  return (
    <div className="rounded-xl bg-zinc-950/50 p-3">
      <div className="text-[11px] font-bold text-zinc-300">{label}</div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
          {current ? (
            <AssetPreview asset={current} className="h-14" />
          ) : (
            <div className="flex h-14 items-center justify-center bg-zinc-900 text-[10px] text-zinc-600">
              default
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-400">
            {current ? current.originalName : "Using the built-in default"}
          </div>
          <div className="mt-1 flex gap-1.5">
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
            >
              {open ? "Close" : "Choose"}
            </button>
            {value && (
              <button
                onClick={() => onPick("")}
                className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-400 hover:bg-zinc-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg bg-zinc-900/60 p-2 sm:grid-cols-4">
          {assets.length === 0 && (
            <div className="col-span-full p-3 text-center text-[11px] text-zinc-600">
              Nothing in the library yet — upload something in Media Library first.
            </div>
          )}
          {assets.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                onPick(a.id);
                setOpen(false);
              }}
              className={`overflow-hidden rounded-lg ring-1 transition ${
                a.id === value ? "ring-lime-400" : "ring-white/10 hover:ring-white/30"
              }`}
            >
              <AssetPreview asset={a} className="h-14" />
              <div className="truncate p-1 text-[10px] text-zinc-400">{a.originalName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
