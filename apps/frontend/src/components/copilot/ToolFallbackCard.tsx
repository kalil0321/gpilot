"use client";

import { useMemo } from "react";

export interface ToolFallbackCardProps {
  name: string;
  /** "in_progress" | "executing" | "complete" | "success" | "error" — varies by tool */
  status: string;
  /** Tool result, if available. Currently unused but kept in the prop
   *  surface so callers don't need to update. */
  result?: string | undefined;
  /** Tool args. Same. */
  parameters?: unknown;
}

/**
 * Inline single-line tool-call indicator. Shows a personalized,
 * human-readable message for each tool the agent invokes — the raw
 * tool name (`fetch_billing`, `list_resources`) was confusing.
 *
 * Visual phases:
 *   running → muted text + shimmer sweep across the line
 *   done    → muted text + small check, no animation
 *   failed  → muted-destructive text + small ✕
 *
 * No "show payload" anymore — the canvas IS the payload.
 */

interface ToolPhrase {
  running: string;
  done: string;
  failed: string;
}

const TOOL_PHRASES: Record<string, ToolPhrase> = {
  fetch_billing: {
    running: "Pulling your GCP billing…",
    done: "Pulled your billing.",
    failed: "Couldn't fetch billing.",
  },
  list_resources: {
    running: "Looking up your resources…",
    done: "Listed your resources.",
    failed: "Couldn't list resources.",
  },
};

function phraseFor(name: string, phase: "running" | "done" | "failed") {
  const known = TOOL_PHRASES[name];
  if (known) return known[phase];
  // Fallback: humanise the snake_case name.
  const human = name.replace(/_/g, " ");
  if (phase === "running") return `Running ${human}…`;
  if (phase === "failed") return `${human} failed.`;
  return `Finished ${human}.`;
}

export function ToolFallbackCard({ name, status }: ToolFallbackCardProps) {
  const phase: "running" | "done" | "failed" = useMemo(() => {
    const s = (status ?? "").toLowerCase();
    if (s.includes("error") || s.includes("fail")) return "failed";
    if (s.includes("complete") || s.includes("success") || s.includes("done"))
      return "done";
    return "running";
  }, [status]);

  const text = phraseFor(name, phase);
  const isRunning = phase === "running";
  const isFailed = phase === "failed";

  return (
    <div
      className="my-1.5 inline-flex items-center gap-2 text-[12.5px] leading-relaxed"
      style={{
        color: isFailed ? "var(--destructive)" : "var(--muted-foreground)",
      }}
    >
      {phase === "done" ? (
        <CheckGlyph />
      ) : isFailed ? (
        <CrossGlyph />
      ) : null}
      <span
        className={isRunning ? "gpilot-shimmer" : undefined}
        style={
          isRunning
            ? {
                backgroundImage:
                  "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ opacity: 0.85 }}
    >
      <path d="M2.5 6.5L5 9l4.5-5.5" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}
