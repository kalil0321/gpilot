"use client";

/**
 * "Agent is thinking" placeholder. Three dots that pulse with a 160ms
 * stagger — communicates "something is happening" during the silent
 * window between the user's submit and the first streamed assistant
 * token. Disappears the moment any assistant content lands.
 *
 * No CopilotKit hook here — visibility is parent-driven (just a `busy`
 * flag from `runAgent`).
 */
export function ThinkingIndicator() {
  return (
    <div
      className="flex items-center gap-1.5 py-3"
      aria-live="polite"
      aria-label="Thinking"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full"
          style={{
            background: "var(--muted-foreground)",
            animation: `gpilot-thinking-pulse 1.1s ease-in-out infinite`,
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </div>
  );
}
