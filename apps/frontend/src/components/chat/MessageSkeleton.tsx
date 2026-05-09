"use client";

/**
 * Loading skeleton for the chat stream — shown during the brief window
 * between landing on /c/[threadId] and `connectAgent` returning the
 * thread's persisted history. Without it, the chat looks empty for
 * 200-800ms and then suddenly fills with messages.
 *
 * Renders 3 alternating "message" rows (right + left + right) with
 * shimmer-animated background bars sized to feel like real messages.
 * Uses the existing gpilot-shimmer animation (sweeping linear-gradient).
 */
export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-2" aria-hidden>
      <SkeletonRow align="right" widths={[60, 80]} />
      <SkeletonRow align="left" widths={[85, 70, 50]} />
      <SkeletonRow align="right" widths={[55]} />
    </div>
  );
}

function SkeletonRow({
  align,
  widths,
}: {
  align: "left" | "right";
  widths: number[];
}) {
  const isRight = align === "right";
  return (
    <div className={isRight ? "flex justify-end" : "flex justify-start"}>
      <div
        className={`flex max-w-[80%] flex-col gap-2 ${
          isRight ? "items-end" : "items-start"
        }`}
      >
        {widths.map((w, i) => (
          <SkeletonBar key={i} widthPct={w} />
        ))}
      </div>
    </div>
  );
}

function SkeletonBar({ widthPct }: { widthPct: number }) {
  return (
    <span
      className="block h-3 rounded-md"
      style={{
        width: `${widthPct}%`,
        minWidth: 56,
        backgroundImage:
          "linear-gradient(90deg, var(--surface-sunken) 0%, var(--muted) 50%, var(--surface-sunken) 100%)",
        backgroundSize: "200% 100%",
        animation: "gpilot-shimmer-sweep 1.6s ease-in-out infinite",
      }}
    />
  );
}
