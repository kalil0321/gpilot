"use client";

import { ExternalLink, FileCode, FolderTree, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  SandboxFile,
  SandboxMeta,
  SandboxPreview,
  TerminalEntry,
} from "@/lib/gpilot/types";

interface SandboxTabProps {
  width: number;
  sandbox?: SandboxMeta;
  terminalLog: TerminalEntry[];
  files: SandboxFile[];
  preview: SandboxPreview | null;
}

/**
 * Sandbox tab content — three stacked panels:
 *
 *   [ Header strip ]   sandbox id + status + workspace + image
 *   [ Preview frame ]  iframe of the exposed port (when set)
 *   [ Terminal pane ]  scrolling buffered log of every sandbox_shell run
 *   [ Files pane ]     list of files the agent has touched
 *
 * The tab renders empty-states for each panel so the user sees the
 * structure even before the agent does anything.
 */
export function SandboxTab({
  width,
  sandbox,
  terminalLog,
  files,
  preview,
}: SandboxTabProps) {
  const innerWidth = width - 40;

  return (
    <div className="flex flex-col gap-4" style={{ width: innerWidth }}>
      <SandboxHeader sandbox={sandbox} />
      {preview ? <PreviewFrame preview={preview} width={innerWidth} /> : null}
      <TerminalPane entries={terminalLog} />
      <FilesPane files={files} />
    </div>
  );
}

// ----- Header ------------------------------------------------------------

function SandboxHeader({ sandbox }: { sandbox?: SandboxMeta }) {
  const status = sandbox?.status ?? (sandbox?.id ? "running" : "idle");
  const id = sandbox?.id;

  return (
    <div
      className="flex items-center justify-between rounded-md px-3 py-2.5"
      style={{
        border: "1px solid var(--border)",
        background: "var(--surface-sunken)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="inline-block size-1.5 rounded-full"
          style={{
            background: status === "running" ? "#3ddc84" : "var(--muted-foreground)",
            boxShadow:
              status === "running" ? "0 0 6px rgba(61,220,132,0.45)" : "none",
          }}
        />
        <span
          className="font-mono text-[11px] uppercase tracking-widest"
          style={{ color: "var(--muted-foreground)" }}
        >
          sandbox · {status}
        </span>
        {id ? (
          <span
            className="ml-2 font-mono text-[11px] tabular-nums"
            style={{ color: "var(--foreground)" }}
            title={id}
          >
            {id.slice(0, 12)}
            {id.length > 12 ? "…" : ""}
          </span>
        ) : null}
      </div>
      {sandbox?.workspace ? (
        <span
          className="truncate font-mono text-[10px]"
          style={{ color: "var(--muted-foreground)", maxWidth: 220 }}
          title={sandbox.workspace}
        >
          {sandbox.workspace}
        </span>
      ) : null}
    </div>
  );
}

// ----- Preview iframe ----------------------------------------------------

function PreviewFrame({
  preview,
  width,
}: {
  preview: SandboxPreview;
  width: number;
}) {
  // Tall-ish iframe height: 60% of canvas width, capped at 480px so it
  // doesn't dominate when the canvas is wide.
  const height = Math.min(480, Math.max(280, Math.round(width * 0.62)));

  return (
    <section>
      <div
        className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--muted-foreground)" }}
      >
        <span>preview · port {preview.port}</span>
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          title="Open in new tab"
        >
          <span className="truncate" style={{ maxWidth: 240 }}>
            {prettyHost(preview.url)}
          </span>
          <ExternalLink size={10} />
        </a>
      </div>
      <div
        className="overflow-hidden rounded-md"
        style={{
          border: "1px solid var(--border)",
          background: "var(--background)",
        }}
      >
        <iframe
          src={preview.url}
          title={`Sandbox preview port ${preview.port}`}
          width="100%"
          height={height}
          // Cross-origin sandbox: we trust the URL (it's the user's own
          // sandbox), but iframe sandbox + restricted referrer keeps
          // the parent frame from leaking origin info accidentally.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{ display: "block", border: 0 }}
        />
      </div>
    </section>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ----- Terminal log ------------------------------------------------------

function TerminalPane({ entries }: { entries: TerminalEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest entry whenever the log grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <section>
      <h3
        className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--muted-foreground)" }}
      >
        <Terminal size={11} />
        <span>terminal · {entries.length}</span>
      </h3>
      <div
        ref={scrollRef}
        className="rounded-md font-mono text-[11.5px] leading-relaxed"
        style={{
          border: "1px solid var(--border)",
          background: "var(--background)",
          color: "var(--foreground)",
          maxHeight: 320,
          minHeight: 80,
          overflowY: "auto",
          padding: "10px 12px",
        }}
      >
        {entries.length === 0 ? (
          <span style={{ color: "var(--muted-foreground)" }}>
            No commands run yet. The agent will use sandbox_shell when needed.
          </span>
        ) : (
          entries.map((entry) => <TerminalRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

function TerminalRow({ entry }: { entry: TerminalEntry }) {
  const [open, setOpen] = useState(false);
  const failed =
    typeof entry.exit_code === "number" && entry.exit_code !== 0;
  const stdout = (entry.stdout ?? "").trimEnd();
  const stderr = (entry.stderr ?? "").trimEnd();
  const hasBody = Boolean(stdout) || Boolean(stderr);

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 text-left transition-colors hover:opacity-80"
        style={{ cursor: hasBody ? "pointer" : "default" }}
      >
        <span style={{ color: "var(--muted-foreground)" }}>$</span>
        <span className="flex-1 truncate" style={{ color: "var(--foreground)" }}>
          {entry.command}
        </span>
        <span
          className="shrink-0 tabular-nums"
          style={{
            color: failed ? "var(--destructive)" : "var(--muted-foreground)",
            fontSize: 10,
          }}
        >
          {failed ? `exit ${entry.exit_code}` : null}
          {!failed && entry.duration_ms != null
            ? `${entry.duration_ms}ms`
            : null}
        </span>
      </button>
      {open && hasBody ? (
        <pre
          className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-sm px-2 py-1.5 text-[11px] leading-snug"
          style={{
            background: "var(--surface-sunken)",
            color: stderr && !stdout ? "var(--destructive)" : "var(--foreground)",
            margin: 0,
          }}
        >
          {stdout || stderr}
        </pre>
      ) : null}
    </div>
  );
}

// ----- Files pane --------------------------------------------------------

function FilesPane({ files }: { files: SandboxFile[] }) {
  return (
    <section>
      <h3
        className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--muted-foreground)" }}
      >
        <FolderTree size={11} />
        <span>files · {files.length}</span>
      </h3>
      <div
        className="rounded-md"
        style={{
          border: "1px solid var(--border)",
          background: "var(--surface-sunken)",
          padding: files.length ? "6px 8px" : "12px",
        }}
      >
        {files.length === 0 ? (
          <span
            className="text-[11.5px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            No files written yet.
          </span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {files.map((f) => (
              <li
                key={f.path}
                className="flex items-baseline gap-2 font-mono text-[11.5px]"
                title={`${f.bytes ?? 0} bytes`}
              >
                <FileCode
                  size={11}
                  style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
                />
                <span
                  className="flex-1 truncate"
                  style={{ color: "var(--foreground)" }}
                >
                  {f.path}
                </span>
                <span
                  className="shrink-0 tabular-nums text-[10px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {formatBytes(f.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
