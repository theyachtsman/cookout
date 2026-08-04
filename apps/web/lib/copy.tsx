"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  COPY_DEFAULTS,
  copyFormat,
  copyLines,
  copyText,
  type AudioSettings,
  type BrandingSettings,
  type Theme,
} from "@cookout/shared";
import { apiUrl } from "./api";

/**
 * Site copy, served from the Command Center.
 *
 * Components call `t("landing.hero.headline")` instead of holding literal
 * text. Until the fetch lands — and forever if it fails — `t` returns the
 * shipped default, so the site reads correctly on first paint and never
 * flashes empty. Editing copy is therefore incapable of breaking a page: the
 * worst an override can do is change words.
 */

export interface PresentationData {
  branding: BrandingSettings;
  theme: Theme | null;
  audio: AudioSettings;
  copy: Record<string, string>;
}

const CopyContext = createContext<Record<string, string>>(COPY_DEFAULTS);

/** Latest copy map for non-React callers (sound cues, imperative helpers). */
export let copyMap: Record<string, string> = COPY_DEFAULTS;

export function CopyProvider({
  value,
  children,
}: {
  value: Record<string, string>;
  children: React.ReactNode;
}) {
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
}

/**
 * The copy hook. Returns `t` for a single string, `lines` for a multiline
 * entry split into rows, and `fmt` for one with {placeholders}.
 */
export function useCopy() {
  const map = useContext(CopyContext);
  return {
    t: (key: string) => copyText(map, key),
    lines: (key: string) => copyLines(map, key),
    fmt: (key: string, vars: Record<string, string | number>) => copyFormat(copyText(map, key), vars),
    map,
  };
}

/** Fetches presentation once and keeps the copy map fresh for the tree. */
export function usePresentation(): PresentationData | null {
  const [data, setData] = useState<PresentationData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${apiUrl()}/api/presentation`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PresentationData | null) => {
          if (!alive || !d) return;
          copyMap = { ...COPY_DEFAULTS, ...d.copy };
          setData(d);
        })
        .catch(() => {
          /* fail open — defaults are always a correct site */
        });
    void load();
    // Copy is decoration-speed, not gameplay state.
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return data;
}
