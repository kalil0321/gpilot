"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WidgetSpec } from "@/lib/gpilot/types";

/**
 * Wraps a single top-level canvas widget with a hover-revealed dismiss
 * button. Dismissals are persisted in localStorage keyed by
 * `(node id, content hash)` — when the agent re-renders that node with
 * different content, the dismissal is invalidated and the node
 * re-appears. So a "dismissed billing-rollup" stays hidden until a new
 * billing query actually changes the data.
 *
 * Action nodes (deploy-*, repo-*, pr-*) are typically immutable once
 * created, so once dismissed they stay dismissed even across reloads —
 * which is what the user expects.
 */

const LS_KEY = "gpilot.dismissedNodes";

function readDismissed(): Map<string, string> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (e): e is [string, string] =>
          Array.isArray(e) &&
          e.length === 2 &&
          typeof e[0] === "string" &&
          typeof e[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

function writeDismissed(map: Map<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify([...map]));
  } catch {
    // ignore (private mode, quota exceeded)
  }
}

/**
 * Hook returning `(isDismissed, dismiss)` keyed by node id + content
 * hash. Re-reads localStorage once on mount and listens for
 * `storage` events so a dismiss on another tab updates this one too.
 */
export function useNodeDismissal() {
  const [dismissed, setDismissed] = useState<Map<string, string>>(() =>
    readDismissed(),
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      setDismissed(readDismissed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isDismissed = useCallback(
    (id: string, hash: string) => dismissed.get(id) === hash,
    [dismissed],
  );

  const dismiss = useCallback(
    (id: string, hash: string) => {
      setDismissed((prev) => {
        const next = new Map(prev);
        next.set(id, hash);
        writeDismissed(next);
        return next;
      });
    },
    [],
  );

  return { isDismissed, dismiss };
}

/**
 * Cheap stable string-hash of a widget's JSON. Not cryptographic —
 * we just need the same widget payload to hash to the same string so
 * dismiss-then-rerender-with-same-content keeps the dismissal alive,
 * and rerender-with-different-content un-dismisses.
 *
 * Uses FNV-1a over JSON.stringify with sorted keys for stability
 * across object key orderings.
 */
export function widgetContentHash(widget: WidgetSpec): string {
  const stable = stableStringify(widget);
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

// ----- per-node dimensions (resize persistence) -------------------------

const LS_DIMS_KEY = "gpilot.nodeDimensions";

interface NodeDims {
  w: number;
  h: number;
}

function readDims(): Map<string, NodeDims> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(LS_DIMS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (e): e is [string, NodeDims] =>
          Array.isArray(e) &&
          e.length === 2 &&
          typeof e[0] === "string" &&
          e[1] != null &&
          typeof e[1] === "object" &&
          typeof (e[1] as NodeDims).w === "number" &&
          typeof (e[1] as NodeDims).h === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

function writeDims(map: Map<string, NodeDims>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_DIMS_KEY, JSON.stringify([...map]));
  } catch {
    // ignore
  }
}

/**
 * Hook returning `(getDims, saveDims)` for per-node width/height
 * persistence across reloads. Listens for cross-tab `storage` events.
 */
export function useNodeDimensions() {
  const [dims, setDims] = useState<Map<string, NodeDims>>(() => readDims());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_DIMS_KEY) return;
      setDims(readDims());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const getDims = useCallback(
    (id: string): NodeDims | undefined => dims.get(id),
    [dims],
  );

  const saveDims = useCallback((id: string, w: number, h: number) => {
    setDims((prev) => {
      const cur = prev.get(id);
      if (cur && Math.abs(cur.w - w) < 2 && Math.abs(cur.h - h) < 2) return prev;
      const next = new Map(prev);
      next.set(id, { w: Math.round(w), h: Math.round(h) });
      writeDims(next);
      return next;
    });
  }, []);

  return { getDims, saveDims };
}

export interface NodeShellProps {
  /** Stable id used for the dismiss key. */
  id: string;
  /** Hash of the widget content; dismissals are per-(id, hash). */
  hash: string;
  onDismiss: () => void;
  /** Persisted dimensions; if undefined, defaults apply. */
  dims?: NodeDims;
  /** Called on user-initiated resize (debounced inside the component). */
  onResize?: (w: number, h: number) => void;
  /** Node label rendered as a small header at the top of the shell. */
  title?: string;
  /** Optional one-liner under the title. */
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Visual chrome around one canvas node:
 *   - Frosted-glass backplate (`--card` @ 88% + backdrop-blur) so the
 *     dot grid doesn't bleed through.
 *   - User-resizable via the native CSS `resize: both` corner handle;
 *     dimensions are persisted in localStorage per node id (debounced
 *     ResizeObserver writes).
 *   - Hover-only × dismiss button with its OWN opaque pill background
 *     so it never visually overlaps content text underneath.
 *   - 1rem internal padding so cards inside don't kiss the edges and
 *     the × stays out of the content area.
 *
 * Default size is 320×auto (auto = content-driven min-height). Once
 * the user resizes, both width and height are pinned and persist.
 */
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 220;
const MAX_WIDTH = 720;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 1200;

export function NodeShell({
  id,
  onDismiss,
  dims,
  onResize,
  title,
  subtitle,
  children,
}: NodeShellProps) {
  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  // ResizeObserver wired once. We persist dimensions via the parent
  // hook (debounced inside `saveDims`) so quick drags don't spam
  // localStorage. The observer also fires once on mount with the
  // current rect — on first mount that "current rect" matches the
  // default we just rendered, so the persisted entry is created
  // proactively (harmless idempotent write).
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!onResize) return;
    const el = ref.current;
    if (!el) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const { width, height } = entry.contentRect;
        // contentRect excludes padding; we want the box width (what
        // localStorage stores so subsequent mounts reproduce the same
        // visual size). offsetWidth/Height includes padding+border.
        onResize(el.offsetWidth, el.offsetHeight);
      }, 180);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timeout) clearTimeout(timeout);
    };
  }, [onResize]);

  return (
    <div
      ref={ref}
      className="group/node relative pointer-events-auto"
      data-node-id={id}
      style={{
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        width: dims?.w ?? DEFAULT_WIDTH,
        height: dims?.h, // undefined → auto
        background: "color-mix(in oklab, var(--card) 88%, transparent)",
        backdropFilter: "blur(10px) saturate(1.1)",
        WebkitBackdropFilter: "blur(10px) saturate(1.1)",
        borderRadius: "0.75rem",
        padding: "1rem",
        paddingRight: "2.5rem", // extra room so × never crowds content
        boxShadow:
          "0 1px 2px rgb(0 0 0 / 0.04), 0 6px 20px -10px rgb(0 0 0 / 0.18)",
        resize: "both",
        overflow: "auto",
      }}
    >
      <button
        type="button"
        aria-label="Dismiss node"
        onClick={handleDismiss}
        className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md opacity-0 shadow-sm transition-opacity hover:opacity-100 focus:opacity-100 group-hover/node:opacity-100"
        style={{
          // Opaque pill so the × never visually merges with content
          // beneath it — the button's own surface masks the content.
          background: "var(--card)",
          color: "var(--muted-foreground)",
          border: "1px solid var(--border)",
        }}
        title="Dismiss"
      >
        <X size={13} />
      </button>
      {(title || subtitle) ? (
        <header
          className="mb-2 flex flex-col gap-0.5"
          // Reserve space on the right so the × button (24px wide,
          // 8px from the edge → 32px total) never overlaps the
          // header text, regardless of title length.
          style={{ paddingRight: "1.75rem" }}
        >
          {title ? (
            <span
              className="truncate text-[12.5px] font-semibold uppercase leading-tight tracking-wider"
              style={{ color: "var(--muted-foreground)" }}
              title={title}
            >
              {title}
            </span>
          ) : null}
          {subtitle ? (
            <span
              className="truncate text-[11px] leading-tight"
              style={{ color: "var(--muted-foreground)", opacity: 0.75 }}
              title={subtitle}
            >
              {subtitle}
            </span>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Filters + memoizes the visible-nodes list given the agent's current
 * `dynamic_widgets`. Returns `[id, hash, widget]` triples ready to
 * map into the grid. Caller is responsible for the dismissal hook
 * itself so the same hook can be reused for the dismiss action too.
 */
export function useVisibleNodes(
  widgets: WidgetSpec[],
  isDismissed: (id: string, hash: string) => boolean,
) {
  return useMemo(() => {
    const out: Array<{ id: string; hash: string; widget: WidgetSpec }> = [];
    for (const w of widgets) {
      const id = typeof w.id === "string" && w.id ? w.id : null;
      if (!id) continue; // skip anonymous nodes — render_ui auto-fills, so this is paranoia
      const hash = widgetContentHash(w);
      if (isDismissed(id, hash)) continue;
      out.push({ id, hash, widget: w });
    }
    return out;
  }, [widgets, isDismissed]);
}
