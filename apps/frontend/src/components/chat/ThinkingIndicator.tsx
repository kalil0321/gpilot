"use client";

import { useEffect, useState } from "react";

/**
 * "Agent is thinking" placeholder. Cycles through a small set of
 * verbs every ~2.4s while applying the shared `gpilot-shimmer` text
 * gradient sweep so the whole label feels alive without resorting to
 * loading dots.
 *
 * Visibility is parent-driven (just a `busy` flag from `runAgent`).
 */

const PHRASES = [
  "Thinking",
  "Analyzing",
  "Working on it",
  "Pulling things together",
  "One sec",
];

const ROTATE_MS = 2400;

export function ThinkingIndicator() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % PHRASES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="inline-flex items-center py-3 text-[14px]"
      aria-live="polite"
      aria-label="Thinking"
    >
      <span
        key={index}
        className="gpilot-shimmer gpilot-thinking-fade"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)",
          backgroundSize: "200% 100%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          fontWeight: 500,
        }}
      >
        {PHRASES[index]}…
      </span>
    </div>
  );
}
