"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CopyEntry } from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * The copy editor — every player-facing string on the site.
 *
 * Each row shows its current value against the shipped default, so an operator
 * can always see what they've changed and put any single string back. Edits are
 * batched into one patch and validated server-side; writing a value identical
 * to the default clears the override rather than storing a redundant copy.
 */

interface CopyRow extends CopyEntry {
  value: string;
  overridden: boolean;
}

export function CopyEditorModule() {
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [overrideCount, setOverrideCount] = useState(0);
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    cc<{ entries: CopyRow[]; groups: string[]; overrideCount: number }>("/api/cc/copy")
      .then((d) => {
        setRows(d.entries);
        setGroups(d.groups);
        setOverrideCount(d.overrideCount);
        setDraft({});
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const needle = q.toLowerCase();
    return rows.filter((r) => {
      if (group && r.group !== group) return false;
      if (changedOnly && !r.overridden && !(r.key in draft)) return false;
      if (!needle) return true;
      return `${r.key} ${r.label} ${r.value}`.toLowerCase().includes(needle);
    });
  }, [rows, group, q, changedOnly, draft]);

  const dirty = Object.keys(draft).length;

  const save = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await cc("/api/cc/copy", { method: "PATCH", body: draft });
      setNote(`Saved ${dirty} string${dirty === 1 ? "" : "s"}. Players see it within two minutes.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (row: CopyRow, value: string) =>
    setDraft((d) => {
      const next = { ...d };
      if (value === row.value) delete next[row.key];
      else next[row.key] = value;
      return next;
    });

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10 backdrop-blur">
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
        >
          <option value="">All groups ({rows.length})</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g} ({rows.filter((r) => r.group === g).length})
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search key, label or text…"
          className="min-w-[12rem] flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
        />
        <button
          onClick={() => setChangedOnly((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
            changedOnly ? "bg-amber-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
          }`}
        >
          Changed only ({overrideCount})
        </button>
        <div className="ml-auto flex items-center gap-2">
          {dirty > 0 && (
            <>
              <span className="text-xs font-bold text-amber-300">{dirty} unsaved</span>
              <button
                onClick={() => setDraft({})}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700"
              >
                Discard
              </button>
            </>
          )}
          <button
            onClick={() => void save()}
            disabled={busy || dirty === 0}
            className="rounded-lg bg-lime-400 px-4 py-1.5 text-xs font-black text-zinc-950 transition hover:bg-lime-300 disabled:opacity-30"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <Panel
        title="Site copy"
        subtitle={`${visible.length} of ${rows.length} strings · ${overrideCount} customised`}
        action={
          overrideCount > 0 && (
            <button
              onClick={() => {
                if (!confirm("Reset every customised string back to the shipped wording?")) return;
                void cc("/api/cc/copy/reset", { body: {} })
                  .then(() => {
                    setNote("All copy reset to defaults.");
                    load();
                  })
                  .catch((e) => setError((e as Error).message));
              }}
              className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-black text-red-300 hover:bg-red-500/25"
            >
              Reset all
            </button>
          )
        }
      >
        {visible.length === 0 ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            Nothing matches.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((row) => {
              const value = row.key in draft ? draft[row.key]! : row.value;
              const edited = row.key in draft;
              const differs = value !== row.defaultText;
              return (
                <div
                  key={row.key}
                  className={`rounded-xl p-3 ring-1 ${
                    edited ? "bg-amber-400/[0.06] ring-amber-400/40" : "bg-zinc-950/50 ring-white/5"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-[11px] font-black text-zinc-200">{row.label}</span>
                    <span className="font-mono text-[10px] text-zinc-600">{row.key}</span>
                    {row.overridden && !edited && (
                      <span className="rounded bg-lime-400/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-lime-300">
                        customised
                      </span>
                    )}
                    {differs && (
                      <button
                        onClick={() => set(row, row.defaultText)}
                        title={row.defaultText}
                        className="ml-auto text-[10px] text-zinc-600 hover:text-lime-300"
                      >
                        restore default
                      </button>
                    )}
                  </div>
                  {row.multiline ? (
                    <textarea
                      value={value}
                      rows={Math.min(8, Math.max(2, value.split("\n").length + 1))}
                      onChange={(e) => set(row, e.target.value)}
                      className="w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 text-sm leading-snug outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
                    />
                  ) : (
                    <input
                      value={value}
                      onChange={(e) => set(row, e.target.value)}
                      className="w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
                    />
                  )}
                  {row.note && <div className="mt-0.5 text-[10px] text-zinc-600">{row.note}</div>}
                  {differs && (
                    <div className="mt-1 truncate text-[10px] text-zinc-600">
                      Default: <span className="text-zinc-500">{row.defaultText}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
