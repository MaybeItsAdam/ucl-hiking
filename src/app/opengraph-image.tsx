import { ImageResponse } from "next/og";

export const alt = "UCL Hiking Club: weekend walks, mountain weekends and good company";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card, in the brand's flat teal, navy ridge and lime trail (branding/brand.md). */
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
          background: "#01a2a6",
          color: "#ffffff",
          padding: "72px 80px 0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: -2 }}>UCL Hiking Club</div>
          <div style={{ width: 360, height: 8, background: "#bdf271", marginTop: 12 }} />
          <div style={{ fontSize: 44, marginTop: 36, maxWidth: 980 }}>
            Weekend walks, mountain weekends and good company. Open to every UCL student.
          </div>
        </div>
        <svg width="1200" height="170" viewBox="0 0 1040 170" preserveAspectRatio="none" style={{ marginLeft: -80 }}>
          <path d="M0 170 L170 40 L330 130 L520 10 L700 120 L860 50 L1040 150 L1040 170 Z" fill="#2c3e50" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
