import { ImageResponse } from "next/og";

// Branded social card generated at build time (Vercel-native, no binary asset).
export const alt = "The Cookout — live multiplayer trading arena with a weekly ETH jackpot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Decorative candlestick motif (deterministic heights, up/down).
const BARS = [
  [120, 1], [70, 0], [150, 1], [200, 1], [110, 0], [90, 0], [170, 1], [140, 1],
  [80, 0], [190, 1], [130, 1], [60, 0], [160, 1], [100, 0], [180, 1], [120, 1],
  [95, 0], [210, 1], [75, 0], [145, 1], [115, 1], [85, 0], [165, 1], [125, 1],
] as const;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0d0b",
          padding: "76px 84px",
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
            height: 320,
            display: "flex",
            background: "linear-gradient(180deg, rgba(163,230,53,0.16), rgba(163,230,53,0))",
          }}
        />
        {/* candlestick motif along the bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 240,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            padding: "0 40px",
            opacity: 0.22,
          }}
        >
          {BARS.map(([h, up], i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 26,
                height: h,
                borderRadius: 5,
                background: up ? "#22c55e" : "#ef4444",
              }}
            />
          ))}
        </div>

        {/* chip */}
        <div style={{ display: "flex", position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "2px solid rgba(163,230,53,0.55)",
              borderRadius: 999,
              padding: "10px 24px",
              color: "#bef264",
              fontSize: 26,
              letterSpacing: 4,
            }}
          >
            OPEN BETA · @hoodcookout
          </div>
        </div>

        {/* title + tagline */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ display: "flex", fontSize: 158, letterSpacing: -5, lineHeight: 1 }}>
            <span style={{ color: "#a3e635", marginRight: 26 }}>THE</span>
            <span style={{ color: "#fafafa" }}>COOKOUT</span>
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 40, color: "#d4d4d8", maxWidth: 920 }}>
            The live multiplayer trading arena — fair-open PvP rounds, XP quests, and a weekly ETH
            jackpot.
          </div>
        </div>

        {/* cta */}
        <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
          <div style={{ display: "flex", width: 14, height: 46, background: "#a3e635", borderRadius: 4, marginRight: 22 }} />
          <div style={{ display: "flex", fontSize: 36, color: "#fafafa" }}>
            Get whitelisted on X → @hoodcookout
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
