"use client";

import { useEffect } from "react";
import type { AudioSettings, BrandingSettings, Theme } from "@cookout/shared";
import { apiUrl } from "../lib/api";

/**
 * Applies Command Center presentation settings to the running site.
 *
 * Brand colours and the active seasonal theme arrive as data and are written
 * to CSS custom properties on :root, so the whole app reskins without a
 * deploy. Everything here is additive and fail-open: if the request errors,
 * nothing is written and the site keeps its built-in look exactly as it is.
 * A theme must never be able to break the app it decorates.
 */

export interface PresentationData {
  branding: BrandingSettings;
  theme: Theme | null;
  audio: AudioSettings;
}

/** Latest presentation payload, for code that needs it outside React. */
export let presentation: PresentationData | null = null;

/** Resolve a media asset id to its served URL. */
export function mediaUrl(id: string | undefined): string | undefined {
  return id ? `${apiUrl()}/media/${id}` : undefined;
}

export function PresentationProvider() {
  useEffect(() => {
    let cancelled = false;

    const apply = (data: PresentationData) => {
      presentation = data;
      const root = document.documentElement;
      // The theme's colours win over branding's, which win over the built-in
      // stylesheet. Empty values are skipped so a blank field means "default"
      // rather than "transparent".
      const colors = { ...data.branding.colors, ...(data.theme?.colors ?? {}) };
      for (const [key, value] of Object.entries(colors)) {
        const prop = `--brand-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        if (value) root.style.setProperty(prop, value);
        else root.style.removeProperty(prop);
      }

      const effects = data.theme?.effects;
      root.style.setProperty("--theme-radius-scale", String(effects?.radiusScale ?? 1));
      root.dataset.themeGlow = effects?.glow ? "on" : "off";
      root.dataset.themeParticles = effects?.particles ?? "none";
      root.dataset.theme = data.theme?.id ?? "";

      // Background art, when a theme or branding supplies one.
      const bgId = data.theme?.assets?.background || data.branding.assets.background;
      if (bgId) {
        root.style.setProperty("--theme-background-image", `url(${apiUrl()}/media/${bgId})`);
        root.dataset.themeBackground = "on";
      } else {
        root.style.removeProperty("--theme-background-image");
        root.dataset.themeBackground = "off";
      }
    };

    const load = () =>
      fetch(`${apiUrl()}/api/presentation`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PresentationData | null) => {
          if (!cancelled && d) apply(d);
        })
        .catch(() => {
          /* fail open — the built-in look is always a valid fallback */
        });

    void load();
    // Picks up a theme going live (or its scheduled window opening) without a
    // reload. Slow on purpose: this is decoration, not gameplay state.
    const t = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return null;
}
