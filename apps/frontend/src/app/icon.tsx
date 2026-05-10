import { ImageResponse } from "next/og";

// Browser tab favicon — auto-wired by Next.js into <link rel="icon"> at /icon.
// Generated as a PNG via ImageResponse so the rounded tile and stroke
// weight stay crisp on Retina, and so the SVG-vs-favicon-IRL parity issue
// (Safari ignoring SVG strokes at small sizes) goes away.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FAFAFA"
          strokeWidth={2.25}
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
