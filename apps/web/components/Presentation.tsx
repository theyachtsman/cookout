"use client";

import { useEffect } from "react";
import { apiUrl } from "../lib/api";
import { CopyProvider, usePresentation, type PresentationData } from "../lib/copy";

/**
 * Applies Command Center presentation settings to the running site.
 *
 * Brand colours and the active seasonal theme arrive as data and are written
 * to CSS custom properties on :root, so the whole app reskins without a
 * deploy. Everything here is additive and fail-open: if the request errors,
 * nothing is written and the site keeps its built-in look exactly as it is.
 * A theme must never be able to break the app it decorates.
 */

/** Latest presentation payload, for code that needs it outside React. */
export let presentation: PresentationData | null = null;

/** Resolve a media asset id to its served URL. */
export function mediaUrl(id: string | undefined): string | undefined {
  return id ? `${apiUrl()}/media/${id}` : undefined;
}

/**
 * Applies branding + theme to the document and supplies site copy to the tree.
 * One fetch feeds both, so a reskin and a copy edit land together.
 */
export function PresentationProvider({ children }: { children?: React.ReactNode }) {
  const data = usePresentation();

  useEffect(() => {
    if (!data) return;
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
    apply(data);
  }, [data]);

  // Children render against the served copy, falling back to the shipped
  // defaults until (or unless) the fetch lands.
  return <CopyProvider value={data?.copy ?? {}}>{children}</CopyProvider>;
}
