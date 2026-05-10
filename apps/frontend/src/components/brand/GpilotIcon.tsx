import * as React from "react";

/**
 * Canonical gpilot brand mark — paper-plane glyph.
 *
 * Single-color outline that inherits `currentColor`, matching
 * `public/gpilot-mark.svg` 1:1. Use it anywhere you want the brand
 * glyph in-flow (header logo, empty states, loading affordances).
 *
 * For square favicon/PWA tiles, use the rendered icons in
 * `app/icon.tsx` and `app/apple-icon.tsx` instead — those wrap this
 * shape on a dark rounded tile so it survives at 16px.
 */
export function GpilotIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
