"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import { BillingChartCard } from "@/components/gpilot/BillingChartCard";
import { ResourceCard } from "@/components/gpilot/ResourceCard";
import { mergeAgentState } from "@/lib/gpilot/types";

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DOT_BASE = 16;

interface CanvasPaneProps {
  open: boolean;
  width: number;
  onResize: (next: number) => void;
  onContentArrived?: () => void;
}

/**
 * Right-side canvas pane — now a real pannable + zoomable surface.
 *
 *   trackpad two-finger swipe / mouse-wheel  → pan
 *   cmd/ctrl + wheel  /  trackpad pinch       → zoom (around cursor)
 *   click + drag on empty background          → pan
 *   [+] [−] [⤢] buttons (top-right)           → zoom controls
 *
 * Dot-grid background scales with the zoom factor and offsets with
 * the pan, so it reads as an infinite plane (React Flow / Figma feel).
 *
 * Cards still render in their own normal flex column inside the
 * transformed surface — zooming the surface scales the cards too.
 */
export function CanvasPane({
  open,
  width,
  onResize,
  onContentArrived,
}: CanvasPaneProps) {
  const { agent } = useAgent();
  const state = useMemo(() => mergeAgentState(agent?.state), [agent?.state]);
  const hasContent =
    state.billing_periods.length > 0 || state.resources.length > 0;

  const prevHadContentRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevHadContentRef.current;
    if (prev === false && hasContent) onContentArrived?.();
    prevHadContentRef.current = hasContent;
  }, [hasContent, onContentArrived]);

  // ----- resize handle -----------------------------------------------------
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
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

  // ----- pan + zoom --------------------------------------------------------
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  // Zoom around a screen-space point (cursor or pane centre) so the
  // pixel under the cursor stays put during the zoom.
  const zoomAround = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      setZoom((prev) => {
        const next = clampZoom(prev * factor);
        if (next === prev) return prev;
        // World point under cursor: (screen - pan) / zoom
        // After zoom: new pan = screen - worldPoint * newZoom
        setPan((p) => ({
          x: screenX - ((screenX - p.x) / prev) * next,
          y: screenY - ((screenY - p.y) / prev) * next,
        }));
        return next;
      });
    },
    [],
  );

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAround(factor, e.clientX - rect.left, e.clientY - rect.top);
    } else {
      e.preventDefault();
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  // Click + drag on the background to pan. Cards still scroll / interact
  // normally because the listener checks event.target against the
  // surface root — drags that start INSIDE a card (Card component or
  // its children) are ignored here.
  const panDragRef = useRef<{ startX: number; startY: number; basePanX: number; basePanY: number } | null>(null);
  const onMouseDownPan = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      basePanX: pan.x,
      basePanY: pan.y,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = panDragRef.current;
      if (!d) return;
      setPan({
        x: d.basePanX + (e.clientX - d.startX),
        y: d.basePanY + (e.clientY - d.startY),
      });
    };
    const onUp = () => {
      if (!panDragRef.current) return;
      panDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <aside
      aria-hidden={!open}
      className="relative hidden h-screen shrink-0 flex-col overflow-hidden xl:flex"
      style={{
        width: open ? width : 0,
        borderLeft: open ? "1px solid var(--border)" : "0px solid transparent",
        transition:
          "width 220ms cubic-bezier(0.22, 1, 0.36, 1), border-color 220ms",
      }}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize canvas"
          onMouseDown={(e) => {
            startXRef.current = e.clientX;
            startWidthRef.current = width;
            setDragging(true);
          }}
          className="absolute left-0 top-0 z-30 h-full w-1 cursor-col-resize transition-colors hover:bg-foreground/10"
          style={{
            background: dragging ? "var(--foreground)" : "transparent",
            opacity: dragging ? 0.15 : 1,
          }}
        />
      ) : null}

      <div
        className="flex h-full flex-col"
        style={{ width, minWidth: width }}
      >
        {/* Pannable / zoomable surface. Dot-grid lives on this outer
            element with a background-position/-size driven by pan + zoom
            so it feels infinite. The transformed inner div carries the
            actual content. */}
        <div
          ref={surfaceRef}
          className="relative flex-1 overflow-hidden"
          onWheel={onWheel}
          onMouseDown={onMouseDownPan}
          style={{
            cursor: panDragRef.current ? "grabbing" : "grab",
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: `${DOT_BASE * zoom}px ${DOT_BASE * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* Zoom controls — fixed top-right of the surface, NOT scaled. */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border bg-card/90 px-1 py-1 backdrop-blur"
               style={{ borderColor: "var(--border)" }}>
            <CtlButton onClick={() => zoomAround(1 - ZOOM_STEP, 0, 0)} aria-label="Zoom out">
              <Minus size={13} />
            </CtlButton>
            <span
              className="px-1 font-mono text-[10px] tabular-nums"
              style={{ color: "var(--muted-foreground)" }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <CtlButton onClick={() => zoomAround(1 + ZOOM_STEP, 0, 0)} aria-label="Zoom in">
              <Plus size={13} />
            </CtlButton>
            <CtlButton onClick={resetView} aria-label="Reset view" title="Reset (1×, centered)">
              <Maximize2 size={12} />
            </CtlButton>
          </div>

          {/* Transformed content layer. */}
          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              minWidth: width,
              padding: "1.25rem 1.25rem 2rem",
            }}
          >
            {hasContent ? (
              <div className="flex flex-col gap-5" style={{ width: width - 40 }}>
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
              <div
                className="flex items-center justify-center"
                style={{
                  width: width - 40,
                  height: 160,
                  pointerEvents: "none",
                }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-widest"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  canvas idle
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Small zoom-control button. Ghost style, scoped to the canvas pane. */
function CtlButton({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-6 place-items-center rounded transition-colors hover:bg-muted"
      style={{ color: "var(--muted-foreground)" }}
      {...rest}
    >
      {children}
    </button>
  );
}
