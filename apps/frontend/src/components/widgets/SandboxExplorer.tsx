"use client";

import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
  Terminal as TerminalIcon,
  TreePine,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import type { WidgetSpec } from "@/lib/gpilot/types";

/**
 * Live, interactive sandbox file explorer rendered as a canvas node.
 *
 * Reads the per-thread sandbox id from `agent.state.sandbox.id` and
 * talks to the BFF (`/api/sandbox/ls` and `/api/sandbox/cat`) to list
 * directories and read files DIRECTLY against the live Daytona
 * sandbox — no agent round-trip, no tool call. The user can click a
 * folder to lazy-expand it, click a file to fetch + view its content
 * inline.
 *
 * Cached responses live in component state, scoped to the current
 * sandbox id. When the sandbox id changes (new thread / fresh box),
 * everything resets.
 */

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

interface LsResponse {
  path: string;
  entries: FileEntry[];
}

interface CatResponse {
  path: string;
  content: string;
  totalBytes: number;
  truncated: boolean;
  binaryHint: boolean;
}

interface ExecResponse {
  command: string;
  cwd: string | null;
  exitCode: number;
  output: string;
  durationMs: number;
}

interface TerminalEntry {
  id: string;
  command: string;
  cwd: string | null;
  state:
    | { kind: "running" }
    | { kind: "done"; exitCode: number; output: string; durationMs: number }
    | { kind: "error"; error: string; durationMs: number };
}

type ExplorerView = "files" | "terminal";

const DEFAULT_ROOT = "/home/daytona";

function joinPath(dir: string, name: string): string {
  if (dir === "/" || dir === "") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SandboxExplorer({ widget }: { widget: WidgetSpec }) {
  const { agent } = useAgent();
  const sandboxId =
    (agent?.state as { sandbox?: { id?: string } } | undefined)?.sandbox?.id ??
    null;
  const sandboxStatus =
    (agent?.state as { sandbox?: { status?: string } } | undefined)?.sandbox
      ?.status ?? "unknown";
  const sandboxWorkspace =
    (agent?.state as { sandbox?: { workspace?: string } } | undefined)?.sandbox
      ?.workspace ?? null;

  const startPath =
    typeof widget.path === "string" && widget.path.trim()
      ? widget.path
      : sandboxWorkspace ?? DEFAULT_ROOT;

  if (!sandboxId) {
    return (
      <div
        className="rounded-md p-3 text-[12px]"
        style={{
          background: "var(--surface-sunken)",
          color: "var(--muted-foreground)",
        }}
      >
        No sandbox is running yet. Ask the agent to spin one up.
      </div>
    );
  }

  return (
    <SandboxExplorerInner
      sandboxId={sandboxId}
      sandboxStatus={sandboxStatus}
      startPath={startPath}
    />
  );
}

function SandboxExplorerInner({
  sandboxId,
  sandboxStatus,
  startPath,
}: {
  sandboxId: string;
  sandboxStatus: string;
  startPath: string;
}) {
  // ----- view tabs (Files / Terminal) ------------------------------------
  const [view, setView] = useState<ExplorerView>("files");

  // ----- ls cache, keyed by absolute path --------------------------------
  const [lsCache, setLsCache] = useState<
    Map<string, { entries: FileEntry[] | null; error?: string; loading: boolean }>
  >(new Map());
  const [openDirs, setOpenDirs] = useState<Set<string>>(
    () => new Set([startPath]),
  );
  const [refreshTick, setRefreshTick] = useState(0);

  // ----- terminal history + input ----------------------------------------
  const [termHistory, setTermHistory] = useState<TerminalEntry[]>([]);
  const [termRunning, setTermRunning] = useState(false);

  // Reset everything when the sandbox id changes (new thread).
  useEffect(() => {
    setLsCache(new Map());
    setOpenDirs(new Set([startPath]));
    setTermHistory([]);
  }, [sandboxId, startPath]);

  const loadDir = useCallback(
    async (path: string) => {
      setLsCache((prev) => {
        const cur = prev.get(path);
        if (cur?.loading) return prev;
        const next = new Map(prev);
        next.set(path, { entries: cur?.entries ?? null, loading: true });
        return next;
      });
      try {
        const res = await fetch(
          `/api/sandbox/ls?sid=${encodeURIComponent(
            sandboxId,
          )}&path=${encodeURIComponent(path)}`,
        );
        const json = (await res.json()) as Partial<LsResponse> & {
          error?: string;
        };
        if (!res.ok) {
          setLsCache((prev) => {
            const next = new Map(prev);
            next.set(path, {
              entries: null,
              loading: false,
              error: json.error ?? `HTTP ${res.status}`,
            });
            return next;
          });
          return;
        }
        const entries = Array.isArray(json.entries) ? json.entries : [];
        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setLsCache((prev) => {
          const next = new Map(prev);
          next.set(path, { entries, loading: false });
          return next;
        });
      } catch (e) {
        setLsCache((prev) => {
          const next = new Map(prev);
          next.set(path, {
            entries: null,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          });
          return next;
        });
      }
    },
    [sandboxId],
  );

  // Auto-load any open directory that isn't cached yet (or when the user
  // hits refresh, which bumps refreshTick → re-runs and re-fetches all
  // open dirs by clearing them from the cache first).
  useEffect(() => {
    for (const path of openDirs) {
      const cached = lsCache.get(path);
      if (!cached || (cached.entries === null && !cached.loading && !cached.error)) {
        void loadDir(path);
      }
    }
  }, [openDirs, lsCache, loadDir]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const refreshAll = useCallback(() => {
    // Wipe cache entries for currently-open dirs so the auto-load
    // effect re-fetches them.
    setLsCache((prev) => {
      const next = new Map(prev);
      for (const path of openDirs) next.delete(path);
      return next;
    });
    setRefreshTick((n) => n + 1);
  }, [openDirs]);

  // ----- file viewer ------------------------------------------------------
  const [openFile, setOpenFile] = useState<{
    path: string;
    state:
      | { kind: "loading" }
      | { kind: "error"; error: string }
      | { kind: "ready"; content: string; truncated: boolean; totalBytes: number; binaryHint: boolean };
  } | null>(null);

  const viewFile = useCallback(
    async (path: string) => {
      setOpenFile({ path, state: { kind: "loading" } });
      try {
        const res = await fetch(
          `/api/sandbox/cat?sid=${encodeURIComponent(
            sandboxId,
          )}&path=${encodeURIComponent(path)}`,
        );
        const json = (await res.json()) as Partial<CatResponse> & {
          error?: string;
        };
        if (!res.ok) {
          setOpenFile({
            path,
            state: { kind: "error", error: json.error ?? `HTTP ${res.status}` },
          });
          return;
        }
        setOpenFile({
          path,
          state: {
            kind: "ready",
            content: typeof json.content === "string" ? json.content : "",
            truncated: !!json.truncated,
            totalBytes: typeof json.totalBytes === "number" ? json.totalBytes : 0,
            binaryHint: !!json.binaryHint,
          },
        });
      } catch (e) {
        setOpenFile({
          path,
          state: {
            kind: "error",
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
    },
    [sandboxId],
  );

  const closeFile = useCallback(() => setOpenFile(null), []);

  // ----- terminal: run a command -----------------------------------------
  const runCommand = useCallback(
    async (command: string, cwd?: string) => {
      const trimmed = command.trim();
      if (!trimmed || termRunning) return;
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();
      setTermHistory((prev) => [
        ...prev,
        {
          id,
          command: trimmed,
          cwd: cwd ?? null,
          state: { kind: "running" },
        },
      ]);
      setTermRunning(true);
      try {
        const res = await fetch("/api/sandbox/exec", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sid: sandboxId,
            command: trimmed,
            cwd,
          }),
        });
        const json = (await res.json()) as Partial<ExecResponse> & {
          error?: string;
        };
        const durationMs = Date.now() - startedAt;
        if (!res.ok) {
          setTermHistory((prev) =>
            prev.map((e) =>
              e.id === id
                ? {
                    ...e,
                    state: {
                      kind: "error",
                      error: json.error ?? `HTTP ${res.status}`,
                      durationMs,
                    },
                  }
                : e,
            ),
          );
          return;
        }
        setTermHistory((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  state: {
                    kind: "done",
                    exitCode: typeof json.exitCode === "number" ? json.exitCode : -1,
                    output: typeof json.output === "string" ? json.output : "",
                    durationMs:
                      typeof json.durationMs === "number" ? json.durationMs : durationMs,
                  },
                }
              : e,
          ),
        );
      } catch (e) {
        setTermHistory((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  state: {
                    kind: "error",
                    error: e instanceof Error ? e.message : String(e),
                    durationMs: Date.now() - startedAt,
                  },
                }
              : entry,
          ),
        );
      } finally {
        setTermRunning(false);
      }
    },
    [sandboxId, termRunning],
  );

  const clearTerminal = useCallback(() => setTermHistory([]), []);

  // ----- render -----------------------------------------------------------
  return (
    <div
      className="rounded-md"
      style={{
        background: "var(--surface-sunken)",
        padding: "10px 12px",
      }}
    >
      <SandboxHeader
        sandboxId={sandboxId}
        sandboxStatus={sandboxStatus}
        view={view}
        onChangeView={setView}
        onRefresh={view === "files" ? refreshAll : clearTerminal}
        refreshLabel={view === "files" ? "Refresh open folders" : "Clear terminal"}
      />

      {view === "files" ? (
        <>
          <div className="mt-2 text-[12px] font-mono leading-snug">
            <DirNode
              path={startPath}
              name={startPath}
              isRoot
              depth={0}
              openDirs={openDirs}
              lsCache={lsCache}
              onToggleDir={toggleDir}
              onOpenFile={viewFile}
            />
          </div>

          {openFile ? (
            <FileViewer
              path={openFile.path}
              state={openFile.state}
              onClose={closeFile}
              onRefresh={() => viewFile(openFile.path)}
            />
          ) : null}
        </>
      ) : (
        <Terminal
          history={termHistory}
          running={termRunning}
          defaultCwd={startPath}
          onRun={runCommand}
        />
      )}
    </div>
  );
}

function SandboxHeader({
  sandboxId,
  sandboxStatus,
  view,
  onChangeView,
  onRefresh,
  refreshLabel,
}: {
  sandboxId: string;
  sandboxStatus: string;
  view: ExplorerView;
  onChangeView: (next: ExplorerView) => void;
  onRefresh: () => void;
  refreshLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-col" style={{ minWidth: 0 }}>
        <span
          className="truncate font-mono text-[10.5px] uppercase tracking-wider"
          style={{ color: "var(--muted-foreground)" }}
          title={sandboxId}
        >
          {sandboxId.slice(0, 12)}…
        </span>
        <span
          className="font-mono text-[9.5px] uppercase tracking-wider"
          style={{
            color:
              sandboxStatus === "running"
                ? "var(--foreground)"
                : "var(--muted-foreground)",
          }}
        >
          {sandboxStatus}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ViewTab
          icon={<TreePine size={11} />}
          label="files"
          active={view === "files"}
          onClick={() => onChangeView("files")}
        />
        <ViewTab
          icon={<TerminalIcon size={11} />}
          label="term"
          active={view === "terminal"}
          onClick={() => onChangeView("terminal")}
        />
        <button
          type="button"
          onClick={onRefresh}
          title={refreshLabel}
          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-foreground/10"
          style={{ color: "var(--muted-foreground)" }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}

function ViewTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-mono text-[9.5px] uppercase tracking-wider transition-colors"
      style={{
        background: active ? "var(--card)" : "transparent",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
        border: active ? "1px solid var(--border)" : "1px solid transparent",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function DirNode({
  path,
  name,
  isRoot,
  depth,
  openDirs,
  lsCache,
  onToggleDir,
  onOpenFile,
}: {
  path: string;
  name: string;
  isRoot?: boolean;
  depth: number;
  openDirs: Set<string>;
  lsCache: Map<
    string,
    { entries: FileEntry[] | null; error?: string; loading: boolean }
  >;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = openDirs.has(path);
  const cached = lsCache.get(path);

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleDir(path)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-foreground/5"
        style={{
          paddingLeft: `${depth * 12 + 4}px`,
          color: "var(--foreground)",
        }}
      >
        {isOpen ? (
          <ChevronDown size={11} style={{ color: "var(--muted-foreground)" }} />
        ) : (
          <ChevronRight size={11} style={{ color: "var(--muted-foreground)" }} />
        )}
        {isOpen ? (
          <FolderOpen size={12} style={{ color: "var(--muted-foreground)" }} />
        ) : (
          <Folder size={12} style={{ color: "var(--muted-foreground)" }} />
        )}
        <span className="truncate" title={path}>
          {isRoot ? path : name}
        </span>
      </button>
      {isOpen ? (
        <div>
          {cached?.loading && !cached.entries ? (
            <div
              className="px-1 py-0.5 text-[10.5px]"
              style={{
                paddingLeft: `${(depth + 1) * 12 + 4}px`,
                color: "var(--muted-foreground)",
              }}
            >
              loading…
            </div>
          ) : null}
          {cached?.error ? (
            <div
              className="px-1 py-0.5 text-[10.5px]"
              style={{
                paddingLeft: `${(depth + 1) * 12 + 4}px`,
                color: "var(--destructive, var(--muted-foreground))",
              }}
              title={cached.error}
            >
              ⚠ {cached.error}
            </div>
          ) : null}
          {cached?.entries?.length === 0 ? (
            <div
              className="px-1 py-0.5 text-[10.5px]"
              style={{
                paddingLeft: `${(depth + 1) * 12 + 4}px`,
                color: "var(--muted-foreground)",
              }}
            >
              (empty)
            </div>
          ) : null}
          {cached?.entries?.map((e) => {
            const childPath = joinPath(path, e.name);
            return e.isDir ? (
              <DirNode
                key={childPath}
                path={childPath}
                name={e.name}
                depth={depth + 1}
                openDirs={openDirs}
                lsCache={lsCache}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
              />
            ) : (
              <FileRow
                key={childPath}
                path={childPath}
                name={e.name}
                size={e.size}
                depth={depth + 1}
                onOpen={onOpenFile}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  path,
  name,
  size,
  depth,
  onOpen,
}: {
  path: string;
  name: string;
  size: number;
  depth: number;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-foreground/5"
      style={{
        paddingLeft: `${depth * 12 + 4}px`,
        color: "var(--foreground)",
      }}
      title={path}
    >
      <span style={{ width: 11 }} />
      <FileIcon size={12} style={{ color: "var(--muted-foreground)" }} />
      <span className="truncate">{name}</span>
      <span
        className="ml-auto pl-2 text-[10px]"
        style={{ color: "var(--muted-foreground)" }}
      >
        {formatBytes(size)}
      </span>
    </button>
  );
}

function FileViewer({
  path,
  state,
  onClose,
  onRefresh,
}: {
  path: string;
  state:
    | { kind: "loading" }
    | { kind: "error"; error: string }
    | {
        kind: "ready";
        content: string;
        truncated: boolean;
        totalBytes: number;
        binaryHint: boolean;
      };
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="mt-3 overflow-hidden rounded-md"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-2.5 py-1.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span
          className="truncate font-mono text-[11px]"
          style={{ color: "var(--foreground)" }}
          title={path}
        >
          {path}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            title="Re-read file"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-foreground/10"
            style={{ color: "var(--muted-foreground)" }}
          >
            <RefreshCw size={11} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="inline-flex h-6 items-center justify-center rounded-md px-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors hover:bg-foreground/10"
            style={{ color: "var(--muted-foreground)" }}
          >
            close
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {state.kind === "loading" ? (
          <div
            className="text-[11px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            loading…
          </div>
        ) : null}
        {state.kind === "error" ? (
          <div
            className="text-[11px]"
            style={{ color: "var(--destructive, var(--muted-foreground))" }}
          >
            ⚠ {state.error}
          </div>
        ) : null}
        {state.kind === "ready" ? (
          <>
            {state.binaryHint ? (
              <div
                className="mb-1.5 text-[10.5px] uppercase tracking-wider"
                style={{ color: "var(--muted-foreground)" }}
              >
                Looks binary — content rendered as raw text below.
              </div>
            ) : null}
            <pre
              className="m-0 whitespace-pre font-mono text-[11px] leading-snug"
              style={{ color: "var(--foreground)" }}
            >
              {state.content}
            </pre>
            {state.truncated ? (
              <div
                className="mt-2 text-[10.5px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Truncated — showing first {formatBytes(state.content.length)} of{" "}
                {formatBytes(state.totalBytes)}.
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ----- Terminal ---------------------------------------------------------

/**
 * Live shell against the per-thread Daytona sandbox. Each command goes
 * to BFF /api/sandbox/exec; output (stdout+stderr merged by Daytona)
 * lands in the history list. Commands are appended in chronological
 * order; auto-scroll keeps the latest in view; Up/Down browses prior
 * commands like a regular shell.
 */
function Terminal({
  history,
  running,
  defaultCwd,
  onRun,
}: {
  history: TerminalEntry[];
  running: boolean;
  defaultCwd: string;
  onRun: (command: string, cwd?: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new history entries / command running state changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history, running]);

  // Focus input when the terminal mounts and after every command finishes.
  useEffect(() => {
    if (!running) inputRef.current?.focus();
  }, [running]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!draft.trim()) return;
        const cmd = draft;
        setDraft("");
        setHistoryIdx(null);
        void onRun(cmd, defaultCwd);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length === 0) return;
        const nextIdx =
          historyIdx === null
            ? history.length - 1
            : Math.max(0, historyIdx - 1);
        setHistoryIdx(nextIdx);
        setDraft(history[nextIdx]?.command ?? "");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIdx === null) return;
        const nextIdx = historyIdx + 1;
        if (nextIdx >= history.length) {
          setHistoryIdx(null);
          setDraft("");
        } else {
          setHistoryIdx(nextIdx);
          setDraft(history[nextIdx]?.command ?? "");
        }
        return;
      }
    },
    [draft, history, historyIdx, defaultCwd, onRun],
  );

  return (
    <div className="mt-2 flex flex-col" style={{ minHeight: 220 }}>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-md p-2 font-mono text-[11px] leading-snug"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          maxHeight: 360,
          minHeight: 160,
        }}
      >
        {history.length === 0 ? (
          <div style={{ color: "var(--muted-foreground)" }}>
            $ type a command and press Enter — runs live in the sandbox at
            <span style={{ color: "var(--foreground)" }}> {defaultCwd}</span>
          </div>
        ) : (
          history.map((entry) => <TerminalEntryRow key={entry.id} entry={entry} />)
        )}
      </div>

      <form
        className="mt-1.5 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || running) return;
          const cmd = draft;
          setDraft("");
          setHistoryIdx(null);
          void onRun(cmd, defaultCwd);
        }}
      >
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--muted-foreground)" }}
        >
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={running ? "running…" : "ls -la"}
          className="flex-1 rounded-md px-2 py-1 font-mono text-[11px] outline-none"
          style={{
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            opacity: running ? 0.6 : 1,
          }}
        />
        <button
          type="submit"
          disabled={running || !draft.trim()}
          className="inline-flex h-7 items-center rounded-md px-2 font-mono text-[10px] uppercase tracking-wider transition-colors hover:bg-foreground/10 disabled:opacity-40"
          style={{
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          }}
        >
          run
        </button>
      </form>
    </div>
  );
}

function TerminalEntryRow({ entry }: { entry: TerminalEntry }) {
  return (
    <div className="mb-1.5">
      <div style={{ color: "var(--muted-foreground)" }}>
        <span style={{ color: "var(--foreground)" }}>$</span>{" "}
        <span style={{ color: "var(--foreground)" }}>{entry.command}</span>
        {entry.cwd ? (
          <span className="ml-2 text-[10px]" title={entry.cwd}>
            (cwd: {entry.cwd})
          </span>
        ) : null}
      </div>
      {entry.state.kind === "running" ? (
        <div style={{ color: "var(--muted-foreground)" }}>… running</div>
      ) : null}
      {entry.state.kind === "error" ? (
        <div
          style={{ color: "var(--destructive, var(--muted-foreground))" }}
        >
          ⚠ {entry.state.error} ({entry.state.durationMs}ms)
        </div>
      ) : null}
      {entry.state.kind === "done" ? (
        <>
          {entry.state.output ? (
            <pre
              className="m-0 whitespace-pre-wrap"
              style={{ color: "var(--foreground)" }}
            >
              {entry.state.output}
            </pre>
          ) : (
            <div style={{ color: "var(--muted-foreground)", opacity: 0.6 }}>
              (no output)
            </div>
          )}
          <div
            className="text-[10px]"
            style={{
              color:
                entry.state.exitCode === 0
                  ? "var(--muted-foreground)"
                  : "var(--destructive, var(--muted-foreground))",
            }}
          >
            exit {entry.state.exitCode} · {entry.state.durationMs}ms
          </div>
        </>
      ) : null}
    </div>
  );
}
