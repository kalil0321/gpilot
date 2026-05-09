import * as React from "react";

import { cn } from "@/lib/utils";

interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Hide the wordmark, render the paper-plane glyph alone (e.g. favicon, collapsed nav). */
  iconOnly?: boolean;
  /**
   * Render the period in the foreground colour instead of accent —
   * use for monochrome surfaces like dark headers.
   */
  mono?: boolean;
}

/**
 * gpilot brand lockup: paper-plane glyph + wordmark + period accent.
 *
 * The icon's height is tied to the wordmark's cap-height via `1em` so
 * the lockup scales with whatever `font-size` its parent sets — no
 * size prop needed. Default colour is `currentColor` so the wordmark
 * follows the surrounding text colour; the period colour is the only
 * deliberate accent.
 */
export function Logo({
  iconOnly = false,
  mono = false,
  className,
  ...rest
}: LogoProps) {
  return (
    <span
      aria-label={iconOnly ? "gpilot" : undefined}
      className={cn("inline-flex items-baseline gap-[0.3em]", className)}
      style={{
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
      {...rest}
    >
      <PaperPlane
        aria-hidden
        style={{
          width: "0.95em",
          height: "0.95em",
          alignSelf: "center",
          color: "currentColor",
        }}
      />
      {!iconOnly && (
        <span style={{ display: "inline-flex" }}>
          <span>gpilot</span>
          <span
            aria-hidden
            style={{ color: mono ? "currentColor" : "var(--secondary)" }}
          >
            .
          </span>
        </span>
      )}
    </span>
  );
}

function PaperPlane(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
