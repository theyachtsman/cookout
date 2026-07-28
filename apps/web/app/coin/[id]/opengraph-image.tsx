import { ImageResponse } from "next/og";
import type { TokenConcept } from "@cookout/shared";

/**
 * The coin card, rendered as a real image. It's the OpenGraph/Twitter card for
 * the /coin/[id] share page AND the picture the Telegram Pit Boss leads its coin
 * broadcasts with (the bot points sendPhoto at this exact URL). Banner behind,
 * coin art + name + $ticker up front, mode and modifier chips, theme, brand.
 */

export const alt = "Coin card · The Cookout";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const MODE_LABEL: Record<string, string> = {
  classic: "Classic · 10m",
  pressure: "Pressure · 7m",
  blitz: "Blitz · 5m",
  reflex: "Reflex · 1m",
  endurance: "Endurance",
};

async function getConcept(id: string): Promise<TokenConcept | null> {
  try {
    const res = await fetch(`${API_URL}/api/concepts/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as TokenConcept;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getConcept(id);
  const name = c?.name ?? "The Cookout";
  const symbol = c?.symbol ?? "COIN";
  const theme = (c?.theme ?? "").slice(0, 140);
  const art = c?.artworkUrl;
  const banner = c?.bannerUrl;
  const modeLabel = c?.mode ? MODE_LABEL[c.mode] : undefined;
  const noRug = c?.mode === "blitz" || c?.mode === "reflex";
  const overtime = !!c?.modifiers?.overtime;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#09090b",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* banner strip (uploaded promo, or a lime wash) */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 300,
            position: "relative",
            background: banner
              ? "#000"
              : "linear-gradient(135deg, rgba(163,230,53,0.20), rgba(9,9,11,0.2))",
          }}
        >
          {banner && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={banner} width={1200} height={300} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              background: "linear-gradient(180deg, rgba(9,9,11,0) 25%, #09090b 100%)",
            }}
          />
        </div>

        {/* identity: art + name + ticker */}
        <div style={{ display: "flex", padding: "0 64px", marginTop: -96, alignItems: "flex-end", gap: 32 }}>
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} width={184} height={184} alt="" style={{ borderRadius: 28, border: "6px solid #09090b", objectFit: "cover" }} />
          ) : (
            <div
              style={{
                display: "flex",
                width: 184,
                height: 184,
                borderRadius: 28,
                border: "6px solid #09090b",
                background: "#27272a",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 92,
              }}
            >
              🪙
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: 16 }}>
            <div style={{ display: "flex", fontSize: 68, fontWeight: 800, color: "#fafafa", letterSpacing: -2 }}>
              {name}
            </div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "#a1a1aa", fontFamily: "monospace" }}>
              ${symbol}
            </div>
          </div>
        </div>

        {/* mode + modifier chips */}
        <div style={{ display: "flex", padding: "24px 64px 0", gap: 14 }}>
          {modeLabel && (
            <div
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 12,
                fontSize: 26,
                fontWeight: 800,
                background: noRug ? "rgba(248,113,113,0.15)" : "rgba(163,230,53,0.15)",
                color: noRug ? "#fca5a5" : "#bef264",
              }}
            >
              {noRug ? "🔥" : "🍳"} {modeLabel}
            </div>
          )}
          {overtime && (
            <div
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 12,
                fontSize: 26,
                fontWeight: 800,
                background: "rgba(56,189,248,0.15)",
                color: "#7dd3fc",
              }}
            >
              ⏱️ Over Time
            </div>
          )}
        </div>

        {theme && (
          <div style={{ display: "flex", padding: "22px 64px 0", fontSize: 30, color: "#d4d4d8" }}>{theme}</div>
        )}

        {/* brand footer */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 40,
            left: 64,
            right: 64,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 12, fontSize: 34, fontWeight: 800 }}>
            <span style={{ color: "#a3e635" }}>THE</span>
            <span style={{ color: "#fafafa" }}>COOKOUT</span>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#a1a1aa" }}>thecookout.fun</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
