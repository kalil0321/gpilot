"use client";

import { useMemo, useState } from "react";

export interface ToolFallbackCardProps {
  name: string;
  /** "in_progress" | "executing" | "complete" | "success" | "error" — varies by tool */
  status: string;
  /** Tool result, if available (string or pre-stringified JSON). */
  result?: string | undefined;
  /** Tool args; used as the "running…" payload before the result lands. */
  parameters?: unknown;
}

/**
 * Inline-in-chat card rendered for every tool call the agent makes.
 *
 * Wired via `useDefaultRenderTool({ render: ToolFallbackCard })` in
 * `app/page.tsx` so the user sees what the agent is doing during
 * multi-second MCP cold-starts. Without this, tool calls happen
 * invisibly and the chat sits silent for 3-5s.
 *
 * Three visual phases driven by `status`:
 *  - running   amber pulsing dot, "running…" tag (in_progress / executing)
 *  - done      mint dot, "done" tag (complete / success)
 *  - failed    coral dot, "failed" tag (any string containing error/fail)
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
      ? "var(--chart-4)" // amber
      : phase === "failed"
        ? "var(--destructive)"
        : "var(--chart-2)"; // mint

  const phaseLabel = phase === "running" ? "running…" : phase;

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
      className="my-2 max-w-[420px] rounded-xl border p-3 text-sm shadow-sm"
      style={{
        borderColor: "var(--border)",
        background: "var(--card)",
        color: "var(--foreground)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full transition-all"
          style={{
            background: dotColor,
            boxShadow:
              phase === "running" ? `0 0 0 3px ${dotColor}33` : "none",
            animation:
              phase === "running"
                ? "tool-pulse 1.4s ease-in-out infinite"
                : undefined,
          }}
        />
        <span className="font-mono text-[12px]">{name}</span>
        <span
          className="ml-auto font-mono text-[10px] uppercase tracking-wide"
          style={{ color: "var(--muted-foreground)" }}
        >
          {phaseLabel}
        </span>
      </div>

      {payload ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide hover:underline"
          style={{ color: "var(--muted-foreground)" }}
        >
          {open ? "hide" : "show"} payload
        </button>
      ) : null}
      {open && payload ? (
        <pre
          className="mt-2 max-h-48 overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug"
          style={{ background: "var(--muted)", color: "var(--foreground)" }}
        >
          {payload}
        </pre>
      ) : null}

      <style jsx>{`
        @keyframes tool-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.4);
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
}
