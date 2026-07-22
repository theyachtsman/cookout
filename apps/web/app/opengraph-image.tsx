import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The social link card (X / Discord / Telegram embeds). Mascot-forward: the
 * grill master anchors the right side over a lime glow, brand + "just play"
 * promise on the left, candlestick motif underneath. Generated at build time;
 * if the mascot asset can't be read the card still renders without it.
 */
export const alt =
  "The Cookout — every chart is a multiplayer match. Open beta: play free, no wallet needed.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Decorative candlestick motif (deterministic heights, up/down).
const BARS = [
  [120, 1], [70, 0], [150, 1], [200, 1], [110, 0], [90, 0], [170, 1], [140, 1],
  [80, 0], [190, 1], [130, 1], [60, 0], [160, 1], [100, 0], [180, 1], [120, 1],
  [95, 0], [210, 1], [75, 0], [145, 1], [115, 1], [85, 0], [165, 1], [125, 1],
] as const;

async function mascotSrc(): Promise<string | null> {
  try {
    const data = await readFile(join(process.cwd(), "public", "brand", "mascot.png"));
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image() {
  const mascot = await mascotSrc();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0b0d0b",
          padding: "56px 72px",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* top glow */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 300,
            display: "flex",
            background: "linear-gradient(180deg, rgba(163,230,53,0.14), rgba(163,230,53,0))",
          }}
        />
        {/* candlestick motif along the bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 220,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "0 36px",
            opacity: 0.18,
          }}
        >
          {BARS.map(([h, up], i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 24,
                height: h,
                borderRadius: 5,
                background: up ? "#22c55e" : "#ef4444",
              }}
            />
          ))}
        </div>

        {/* left column: the pitch */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            position: "relative",
            gap: 26,
          }}
        >
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                border: "2px solid rgba(163,230,53,0.55)",
                borderRadius: 999,
                padding: "8px 22px",
                color: "#bef264",
                fontSize: 24,
                letterSpacing: 4,
                fontWeight: 700,
              }}
            >
              🔥 OPEN BETA · 100% PAPER MONEY
            </div>
          </div>

          <div
            style={{ display: "flex", gap: 22, fontSize: 100, letterSpacing: -4, lineHeight: 1, fontWeight: 800 }}
          >
            <span style={{ color: "#a3e635" }}>THE</span>
            <span style={{ color: "#fafafa" }}>COOKOUT</span>
          </div>

          <div style={{ display: "flex", fontSize: 34, color: "#e4e4e7", fontWeight: 700 }}>
            Every chart is a multiplayer match.
          </div>

          <div style={{ display: "flex", fontSize: 29, fontWeight: 800, gap: 14 }}>
            <span style={{ color: "#f4f4f5" }}>Same price.</span>
            <span style={{ color: "#34d399" }}>Same second.</span>
            <span style={{ color: "#a3e635" }}>Everyone.</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", marginTop: 8, gap: 16 }}>
            <div
              style={{
                display: "flex",
                width: 12,
                height: 36,
                background: "#a3e635",
                borderRadius: 4,
              }}
            />
            <div style={{ display: "flex", fontSize: 26, color: "#fafafa" }}>
              Play free in under a minute → thecookout.fun
            </div>
          </div>
        </div>

        {/* right: the grill master over a lime glow */}
        {mascot && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 460,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: 460,
                height: 460,
                display: "flex",
                borderRadius: 999,
                background:
                  "radial-gradient(circle, rgba(163,230,53,0.30) 0%, rgba(163,230,53,0.10) 45%, rgba(163,230,53,0) 70%)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascot} alt="" width={430} height={430} style={{ position: "relative" }} />
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
