"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import { BillingChartCard } from "@/components/gpilot/BillingChartCard";
import { ResourceCard } from "@/components/gpilot/ResourceCard";
import { mergeAgentState } from "@/lib/gpilot/types";

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

interface CanvasPaneProps {
  /** Controlled open/closed state. */
  open: boolean;
  /** Pane width in px. Controlled by the parent so the resize handle
   *  can update it. */
  width: number;
  onResize: (next: number) => void;
}

/**
 * Right-side canvas pane on the chat thread page. Controlled by the
 * parent (chat layout) for both open/closed state and width; the
 * parent also owns the toggle button in the chat header.
 *
 * A 4px resize handle sits on the LEFT edge of the pane — drag it
 * horizontally to shrink/grow. Width is clamped to [320, 720] px.
 */
export function CanvasPane({ open, width, onResize }: CanvasPaneProps) {
  const { agent } = useAgent();
  const state = useMemo(() => mergeAgentState(agent?.state), [agent?.state]);

  const hasContent =
    state.billing_periods.length > 0 || state.resources.length > 0;

  // Resize handle — draggable on its left edge
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX; // dragging LEFT grows the pane
      const next = Math.max(
        MIN_WIDTH,
        Math.min(MAX_WIDTH, startWidthRef.current + delta),
      );
      onResize(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onResize]);

  if (!open) return null;

  return (
    <aside
      className="relative hidden h-screen shrink-0 flex-col overflow-y-auto border-l xl:flex"
      style={{
        width,
        borderColor: "var(--border)",
      }}
    >
      {/* Resize handle on the left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize canvas"
        onMouseDown={(e) => {
          startXRef.current = e.clientX;
          startWidthRef.current = width;
          setDragging(true);
        }}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-foreground/10"
        style={{
          background: dragging ? "var(--foreground)" : "transparent",
          opacity: dragging ? 0.15 : 1,
        }}
      />

      <header
        className="sticky top-0 flex items-center justify-between px-5 py-3"
        style={{ background: "var(--background)" }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          canvas
        </span>
        {state.sync?.source ? (
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
            }}
          >
            {state.sync.source}
          </span>
        ) : null}
      </header>

      {hasContent ? (
        <div className="flex-1 space-y-5 px-5 py-3">
          {state.billing_periods.length > 0 ? (
            <BillingChartCard periods={state.billing_periods} />
          ) : null}

          {state.resources.length > 0 ? (
            <section>
              <h3
                className="mb-2 font-mono text-[10px] uppercase tracking-widest"
                style={{ color: "var(--muted-foreground)" }}
              >
                resources · {state.resources.length}
              </h3>
              <div className="grid gap-3">
                {state.resources.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyDotGrid />
      )}
    </aside>
  );
}

/**
 * React-Flow-style empty canvas — radial-gradient dot grid filling
 * the available area. The dots use --border so the pattern reads as
 * "structure, not content"; subtle in light mode, subtle in dark.
 *
 * No actual React Flow dependency: just CSS.
 */
function EmptyDotGrid() {
  return (
    <div
      className="relative flex flex-1 items-center justify-center"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0",
      }}
    >
      <span
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--muted-foreground)" }}
      >
        canvas idle
      </span>
    </div>
  );
}

