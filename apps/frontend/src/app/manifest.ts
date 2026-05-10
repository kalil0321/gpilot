import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest. Auto-linked by Next.js via the
// `manifest` field on the root metadata. iOS reads `name` for "Add to
// Home Screen" and falls back to `apple-icon` for the tile.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gpilot",
    short_name: "Gpilot",
    description: "Agentic interface for Google Cloud.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
