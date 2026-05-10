"use client";

import { Maximize2, Minus, Plus, Server, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import { SandboxTab } from "@/components/gpilot/SandboxTab";
import {
  NodeShell,
  useNodeDimensions,
  useNodeDismissal,
  useVisibleNodes,
} from "@/components/canvas/NodeShell";
import { DynamicWidget } from "@/components/widgets/DynamicWidget";
import { mergeAgentState } from "@/lib/gpilot/types";

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DOT_BASE = 16;

const LS_TAB = "gpilot.canvasTab";

type CanvasTab = "canvas" | "sandbox";

interface CanvasPaneProps {
  open: boolean;
  width: number;
  onResize: (next: number) => void;
  onContentArrived?: () => void;
}

/**
 * Right-side canvas pane with two surfaces:
 *
 *   [Canvas]    agent-rendered widgets on a pannable + zoomable plane
 *               (dot grid, drag empty space to pan, scroll to pan,
 *               cmd/ctrl+wheel to zoom, corner controls).
 *
 *   [Sandbox]   terminal log + file list + live preview iframe of the
 *               Daytona sandbox. Kept as its own tab because the iframe
 *               and live-streaming console feel weird when scaled or
 *               composed alongside arbitrary widgets.
 *
 * Auto-tab-switch heuristic: tools tag their canvas update with
 * `sync.source` — "ui" for render_ui, "daytona" for sandbox tools.
 * When syncedAt changes, we read source and flip to the matching tab
 * so the user always sees what just changed.
 */
export function CanvasPane({
  open,
  width,
  onResize,
  onContentArrived,
}: CanvasPaneProps) {
  const { agent } = useAgent();
  const state = useMemo(() => mergeAgentState(agent?.state), [agent?.state]);

  // Per-node dismissal — keyed by `(node id, content hash)`. A node
  // re-appears automatically when the agent re-renders it with new
  // content (hash changes), so dismissals only suppress what the user
  // already saw.
  const { isDismissed, dismiss } = useNodeDismissal();
  const visibleNodes = useVisibleNodes(state.dynamic_widgets, isDismissed);

  // Per-node persisted (width, height). Updated by the NodeShell's
  // ResizeObserver when the user drags the corner handle.
  const { getDims, saveDims } = useNodeDimensions();

  const hasRender = visibleNodes.length > 0;
  const hasSandbox =
    Boolean(state.sandbox?.id) ||
    state.terminal_log.length > 0 ||
    state.sandbox_files.length > 0 ||
    state.sandbox_preview != null;
  const hasContent = hasRender || hasSandbox;

  // ----- tabs --------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<CanvasTab>(() => {
    if (typeof window === "undefined") return "canvas";
    const raw = window.localStorage.getItem(LS_TAB);
    return raw === "sandbox" ? "sandbox" : "canvas";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_TAB, activeTab);
    } catch {
      // ignore (private mode etc.)
    }
  }, [activeTab]);

  // Auto-open + auto-switch on a new tool-driven sync. Two policies:
  //   - source === "ui" (render_ui) → ALWAYS switch to the canvas tab
  //     so the user sees what just got drawn.
  //   - source === "daytona" → switch to the sandbox tab ONLY on the
  //     FIRST appearance of the per-thread sandbox id. Subsequent
  //     sandbox events (file writes, shell execs, port exposes) leave
  //     the user wherever they currently are — once the sandbox is
  //     live, the canvas surface is usually more interesting.
  //
  // We watch `sync.syncedAt` because it changes on every successful
  // canvas tool call (and rehydrated threads keep the persisted value
  // through the first render unchanged, so we don't accidentally
  // reopen on load).
  const prevSyncedAtRef = useRef<string | undefined>(state.sync?.syncedAt);
  const sawSandboxIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSyncedAtRef.current;
    const cur = state.sync?.syncedAt;
    if (cur && cur !== prev) {
      const src = state.sync?.source ?? "";
      if (src === "ui") {
        setActiveTab("canvas");
      } else if (src === "daytona") {
        const sandboxId = state.sandbox?.id ?? null;
        // First time we see this sandbox id: switch tabs once.
        if (sandboxId && sawSandboxIdRef.current !== sandboxId) {
          setActiveTab("sandbox");
          sawSandboxIdRef.current = sandboxId;
        }
      }
      if (hasContent) onContentArrived?.();
    }
    prevSyncedAtRef.current = cur;
  }, [
    state.sync?.syncedAt,
    state.sync?.source,
    state.sandbox?.id,
    hasContent,
    onContentArrived,
  ]);

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

  // ----- pan + zoom (canvas tab only; state kept when switching tabs) -----
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    basePanX: number;
    basePanY: number;
  } | null>(null);
  const [surfacePanDragging, setSurfacePanDragging] = useState(false);

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);

  const zoomAround = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      setZoom((prev) => {
        const next = clampZoom(prev * factor);
        if (next === prev) return prev;
        setPan((p) => ({
          x: screenX - ((screenX - p.x) / prev) * next,
          y: screenY - ((screenY - p.y) / prev) * next,
        }));
        return next;
      });
    },
    [clampZoom],
  );

  const onWheelCanvas = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
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
    },
    [zoomAround],
  );

  const onMouseDownPan = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (e.target !== e.currentTarget) return;
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        basePanX: pan.x,
        basePanY: pan.y,
      };
      setSurfacePanDragging(true);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    },
    [pan.x, pan.y],
  );

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
      setSurfacePanDragging(false);
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

  const resetCanvasView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomFromViewportCentre = useCallback(
    (factor: number) => {
      const el = surfaceRef.current;
      const vw = el?.clientWidth ?? width;
      const vh = el?.clientHeight ?? 480;
      zoomAround(factor, vw / 2, vh / 2);
    },
    [zoomAround, width],
  );

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

      <div className="flex h-full flex-col" style={{ width, minWidth: width }}>
        <TabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          renderCount={visibleNodes.length}
          terminalCount={state.terminal_log.length}
          sandboxRunning={Boolean(state.sandbox?.id)}
          previewLive={state.sandbox_preview != null}
        />

        {activeTab === "canvas" ? (
          <div
            ref={surfaceRef}
            className="relative flex-1 select-none overflow-hidden"
            onWheel={onWheelCanvas}
            onMouseDown={onMouseDownPan}
            style={{
              cursor: surfacePanDragging ? "grabbing" : "grab",
              backgroundImage:
                "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 22%, var(--border)) 1px, transparent 0)",
              backgroundSize: `${DOT_BASE * zoom}px ${DOT_BASE * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          >
            <div
              className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border bg-card/90 px-1 py-1 backdrop-blur"
              style={{ borderColor: "var(--border)" }}
            >
              <CtlButton
                aria-label="Zoom out"
                onClick={() => zoomFromViewportCentre(1 - ZOOM_STEP)}
              >
                <Minus size={13} />
              </CtlButton>
              <span
                className="pointer-events-none select-none px-1 font-mono text-[10px] tabular-nums"
                style={{ color: "var(--muted-foreground)" }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <CtlButton
                aria-label="Zoom in"
                onClick={() => zoomFromViewportCentre(1 + ZOOM_STEP)}
              >
                <Plus size={13} />
              </CtlButton>
              <CtlButton
                aria-label="Reset view"
                title="Reset (1×, centred)"
                onClick={resetCanvasView}
              >
                <Maximize2 size={12} />
              </CtlButton>
            </div>

            <div
              className="pointer-events-none absolute left-0 top-0"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                minWidth: width,
                padding: "1.25rem 1.25rem 2rem",
              }}
            >
              {hasRender ? (
                <div
                  className="pointer-events-auto flex flex-col gap-3"
                  style={{ width: Math.max(200, width - 40) }}
                >
                  {/* Notion-board canvas: free flex-wrap layout so each
                      node carries its own resizable width/height
                      (persisted in localStorage by NodeShell). Nodes
                      pack left-to-right and wrap when the row fills,
                      so resizing one card naturally reflows the rest.
                      Each node's title/subtitle are pulled UP into
                      the NodeShell header and stripped from the inner
                      widget so cards don't render their title twice. */}
                  <div
                    className="flex w-full flex-wrap"
                    style={{
                      gap: "0.75rem",
                      alignItems: "flex-start",
                    }}
                  >
                    {visibleNodes.map(({ id, hash, widget }) => {
                      const nodeTitle =
                        typeof widget.title === "string" ? widget.title : "";
                      const nodeSubtitle =
                        typeof widget.subtitle === "string"
                          ? widget.subtitle
                          : "";
                      const innerWidget =
                        nodeTitle || nodeSubtitle
                          ? { ...widget, title: undefined, subtitle: undefined }
                          : widget;
                      return (
                        <NodeShell
                          key={id}
                          id={id}
                          hash={hash}
                          dims={getDims(id)}
                          onResize={(w, h) => saveDims(id, w, h)}
                          onDismiss={() => dismiss(id, hash)}
                          title={nodeTitle}
                          subtitle={nodeSubtitle}
                        >
                          <DynamicWidget widget={innerWidget} />
                        </NodeShell>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div
                  className="pointer-events-none flex items-center justify-center"
                  style={{ width: Math.max(200, width - 40), height: 200 }}
                >
                  <span
                    className="font-mono text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    ask the agent to render something
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto"
            style={{
              padding: "1.25rem 1.25rem 2rem",
              background: "var(--background)",
            }}
          >
            <SandboxTab
              width={width}
              sandbox={state.sandbox}
              terminalLog={state.terminal_log}
              files={state.sandbox_files}
              preview={state.sandbox_preview}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

// ----- Tab bar -----------------------------------------------------------

function TabBar({
  activeTab,
  onChange,
  renderCount,
  terminalCount,
  sandboxRunning,
  previewLive,
}: {
  activeTab: CanvasTab;
  onChange: (next: CanvasTab) => void;
  renderCount: number;
  terminalCount: number;
  sandboxRunning: boolean;
  previewLive: boolean;
}) {
  return (
    <div
      className="flex select-none items-center gap-0 px-3"
      style={{
        height: 40,
        borderBottom: "1px solid var(--border)",
        background: "var(--background)",
      }}
    >
      <TabButton
        active={activeTab === "canvas"}
        onClick={() => onChange("canvas")}
        icon={<Sparkles size={12} />}
        label="canvas"
        badge={renderCount > 0 ? String(renderCount) : undefined}
      />
      <TabButton
        active={activeTab === "sandbox"}
        onClick={() => onChange("sandbox")}
        icon={<Server size={12} />}
        label="sandbox"
        badge={
          previewLive
            ? "live"
            : terminalCount > 0
              ? String(terminalCount)
              : sandboxRunning
                ? "on"
                : undefined
        }
        accent={previewLive ? "live" : undefined}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  accent?: "live";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-full items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors"
      style={{
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      {badge ? (
        <span
          className="ml-1 inline-flex items-center rounded-sm px-1 py-px font-mono text-[9px] uppercase tracking-wider"
          style={{
            background:
              accent === "live"
                ? "color-mix(in oklab, #3ddc84 14%, var(--surface-sunken))"
                : "var(--surface-sunken)",
            color:
              accent === "live"
                ? "color-mix(in oklab, #3ddc84 80%, var(--foreground))"
                : "var(--muted-foreground)",
            border: "1px solid var(--border)",
          }}
        >
          {badge}
        </span>
      ) : null}
      {/* active underline */}
      <span
        aria-hidden
        className="absolute bottom-0 left-2 right-2 h-px transition-opacity"
        style={{
          background: "var(--foreground)",
          opacity: active ? 1 : 0,
        }}
      />
    </button>
  );
}

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
