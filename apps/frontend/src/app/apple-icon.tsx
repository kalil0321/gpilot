import { ImageResponse } from "next/og";

// Apple touch icon — auto-wired by Next.js into <link rel="apple-touch-icon">
// at /apple-icon. iOS strips transparency and adds its own corner mask, so
// we render onto a fully opaque dark tile with no transparent pixels.
//
// 180×180 is the standard iOS home-screen size (iPhone Plus / Pro Max).
// The plane is sized to ~62% of the tile for a comfortable safe area.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0A0B",
        }}
      >
        <svg
          width="112"
          height="112"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FAFAFA"
          strokeWidth={1.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
