import * as React from "react";

import { cn } from "@/lib/utils";
import { GpilotIcon } from "./GpilotIcon";

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
      <GpilotIcon
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

