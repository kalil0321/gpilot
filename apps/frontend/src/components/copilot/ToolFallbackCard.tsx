"use client";

import { useMemo, useState } from "react";

export interface ToolFallbackCardProps {
  name: string;
  /** "in_progress" | "executing" | "complete" | "success" | "error" — varies by tool */
  status: string;
  /** Tool result, if available (string or pre-stringified JSON). */
  result?: string | undefined;
  /** Tool args, used as the "running…" payload before the result lands. */
  parameters?: unknown;
}

/**
 * Single-line inline tool-call indicator for the chat stream.
 *
 * Renders as one short row of muted text — a status dot + the tool
 * name in mono, with a tiny `+ payload` toggle that expands inline.
 * No card, no border, no fill: just text that hints at what the
 * agent did without becoming the focal point of the conversation.
 *
 * Three phases driven by `status`:
 *   running  amber pulsing dot, no toggle yet
 *   done     mint dot, payload toggle revealed
 *   failed   coral dot, payload toggle (error text inside)
 */
export function ToolFallbackCard({
  name,
  status,
  result,
  parameters,
}: ToolFallbackCardProps) {
  const [open, setOpen] = useState(false);

  const phase: "running" | "done" | "failed" = useMemo(() => {
    const s = (status ?? "").toLowerCase();
    if (s.includes("error") || s.includes("fail")) return "failed";
    if (s.includes("complete") || s.includes("success") || s.includes("done")) return "done";
    return "running";
  }, [status]);

  const dotColor =
    phase === "running"
      ? "var(--chart-4)"
      : phase === "failed"
        ? "var(--destructive)"
        : "var(--chart-2)";

  const payload = useMemo(() => {
    const value = phase === "done" ? (result ?? parameters) : parameters;
    if (value === undefined || value === null) return "";
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [parameters, result, phase]);

  return (
    <div
      className="my-1.5 inline-flex flex-col gap-1 text-[12px] leading-relaxed"
      style={{ color: "var(--muted-foreground)" }}
    >
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background: dotColor,
            animation:
              phase === "running"
                ? "tool-pulse 1.4s ease-in-out infinite"
                : undefined,
          }}
        />
        <span className="font-mono">{name}</span>
        {payload && phase !== "running" ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: "inherit" }}
            aria-expanded={open}
          >
            {open ? "−" : "+"} payload
          </button>
        ) : null}
      </span>

      {open && payload ? (
        <pre
          className="ml-3.5 mt-0.5 max-h-48 max-w-[400px] overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug"
          style={{
            background: "var(--muted)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          }}
        >
          {payload}
        </pre>
      ) : null}

      <style jsx>{`
        @keyframes tool-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
      `}</style>
    </div>
  );
}
