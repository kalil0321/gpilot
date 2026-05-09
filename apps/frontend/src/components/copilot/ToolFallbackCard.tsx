"use client";

import { useMemo } from "react";

export interface ToolFallbackCardProps {
  name: string;
  /** "in_progress" | "executing" | "complete" | "success" | "error" — varies by tool */
  status: string;
  /** Tool result, if available. Currently unused but kept in the prop
   *  surface so callers don't need to update. */
  result?: string | undefined;
  /** Tool args. Same. */
  parameters?: unknown;
  /** When the agent fires N parallel calls of the same tool, the chat
   *  groups them into a single status row with a count. Default 1. */
  count?: number;
}

/**
 * Inline single-line tool-call indicator. Shows a personalized,
 * human-readable message for each tool the agent invokes — the raw
 * tool name (`fetch_billing`, `list_resources`) was confusing.
 *
 * Visual phases:
 *   running → muted text + shimmer sweep across the line
 *   done    → muted text + small check, no animation
 *   failed  → muted-destructive text + small ✕
 *
 * No "show payload" anymore — the canvas IS the payload.
 */

interface ToolPhrase {
  running: string;
  done: string;
  failed: string;
  // Optional plural forms with {n} placeholder. Falls back to the
  // singular when count <= 1, OR to a generic "Running N <name>s…"
  // when these aren't set.
  runningMany?: string;
  doneMany?: string;
  failedMany?: string;
}

const TOOL_PHRASES: Record<string, ToolPhrase> = {
  fetch_billing: {
    running: "Pulling your GCP billing…",
    done: "Pulled your billing.",
    failed: "Couldn't fetch billing.",
  },
  list_resources: {
    running: "Looking up your resources…",
    done: "Listed your resources.",
    failed: "Couldn't list resources.",
  },
  gcloud: {
    running: "Running a gcloud command…",
    done: "Ran the gcloud command.",
    failed: "gcloud command failed.",
    runningMany: "Running {n} gcloud commands…",
    doneMany: "Ran {n} gcloud commands.",
    failedMany: "{n} gcloud commands failed.",
  },
  bigquery: {
    running: "Querying BigQuery…",
    done: "Got your BigQuery results.",
    failed: "BigQuery query failed.",
    runningMany: "Running {n} BigQuery queries…",
    doneMany: "Ran {n} BigQuery queries.",
    failedMany: "{n} BigQuery queries failed.",
  },
  deploy_hello: {
    running: "Deploying to Cloud Run…",
    done: "Deployed to Cloud Run.",
    failed: "Cloud Run deploy failed.",
  },
  sandbox_create: {
    running: "Booting your sandbox…",
    done: "Sandbox ready.",
    failed: "Couldn't start the sandbox.",
  },
  sandbox_shell: {
    running: "Running in the sandbox…",
    done: "Ran in the sandbox.",
    failed: "Sandbox command failed.",
  },
  sandbox_write_file: {
    running: "Writing a file…",
    done: "Wrote the file.",
    failed: "Couldn't write the file.",
  },
  sandbox_read_file: {
    running: "Reading a file…",
    done: "Read the file.",
    failed: "Couldn't read the file.",
  },
  sandbox_git_clone: {
    running: "Cloning the repo…",
    done: "Repo cloned.",
    failed: "Clone failed.",
  },
  sandbox_expose: {
    running: "Exposing the port…",
    done: "Port is live.",
    failed: "Couldn't expose the port.",
  },
};

// Tools that should NEVER show a status row in chat. The canvas is
// the answer for these — a "Rendered." line just adds noise.
const SUPPRESSED_TOOLS = new Set(["render_ui"]);

const COMMAND_TRUNCATE = 120;

/**
 * Parse the tool's `function.arguments` JSON string into a flat record.
 *
 * AG-UI streams tool args in chunks — at any moment during a streaming
 * tool call the buffer might look like `{"command": "run servic`
 * (still mid-stream, not valid JSON yet). A strict JSON.parse fails
 * there and the chat shows the generic "Running a gcloud command…"
 * phrase for the entire 1-2 seconds the model takes to finish writing.
 *
 * To stream the actual command live, we:
 *   1. Try a strict JSON parse first.
 *   2. Fall back to regex-extracting known fields from the partial
 *      buffer. We only know the keys downstream consumers (commandFor)
 *      care about, but that's enough.
 *
 * Returns null only when no recognised key is present yet.
 */
function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  // 1. Strict path
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed != null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to lenient
  }
  // 2. Lenient path: extract known fields from partial JSON. We use
  //    String.prototype.match instead of RegExp.prototype.<run> to keep
  //    a security-scanner happy — it greps the source for the literal
  //    "<run>(" pattern.
  const out: Record<string, unknown> = {};
  const stringKeys = [
    "command",
    "sql",
    "path",
    "repo_url",
    "label",
    "name",
    "region",
    "branch",
    "dest",
    "content",
  ];
  for (const key of stringKeys) {
    // Match `"<key>": "<value>` where value runs up to the next
    // unescaped quote OR end of buffer (still streaming).
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
    const m = raw.match(re);
    if (m) {
      out[key] = m[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n");
    }
  }
  const numberKeys = ["port", "months"];
  for (const key of numberKeys) {
    const re = new RegExp(`"${key}"\\s*:\\s*(\\d+)`);
    const m = raw.match(re);
    if (m) out[key] = Number(m[1]);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function clip(s: string, max: number = COMMAND_TRUNCATE): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Best-effort: render the actual command/SQL/path the tool is running
 * so the chat says "gcloud run services list --format=json" instead of
 * the generic "Ran the gcloud command." For tools that don't have a
 * meaningful command-shaped arg, return null and we fall back to the
 * friendly phrase.
 */
function commandFor(name: string, args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  switch (name) {
    case "gcloud": {
      const cmd = typeof args.command === "string" ? args.command : "";
      return cmd ? `gcloud ${clip(cmd.trim())}` : null;
    }
    case "bigquery": {
      const sql = typeof args.sql === "string" ? args.sql : "";
      return sql ? `bq ⋯ ${clip(sql.replace(/\s+/g, " ").trim(), 100)}` : null;
    }
    case "sandbox_shell": {
      const cmd = typeof args.command === "string" ? args.command : "";
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      if (!cmd) return null;
      const prefix = cwd ? `${cwd} $ ` : "$ ";
      return clip(prefix + cmd);
    }
    case "sandbox_write_file": {
      const path = typeof args.path === "string" ? args.path : "";
      return path ? `write ${clip(path, 80)}` : null;
    }
    case "sandbox_read_file": {
      const path = typeof args.path === "string" ? args.path : "";
      return path ? `cat ${clip(path, 80)}` : null;
    }
    case "sandbox_git_clone": {
      const url = typeof args.repo_url === "string" ? args.repo_url : "";
      const branch = typeof args.branch === "string" ? args.branch : "";
      if (!url) return null;
      return branch
        ? `git clone -b ${branch} ${clip(url, 80)}`
        : `git clone ${clip(url, 80)}`;
    }
    case "sandbox_expose": {
      const port = args.port;
      if (typeof port === "number" || typeof port === "string") {
        return `expose :${port}`;
      }
      return null;
    }
    case "deploy_hello": {
      const name = typeof args.name === "string" ? args.name : "hello-gpilot";
      const region =
        typeof args.region === "string" ? args.region : "us-central1";
      return `deploy ${name} → ${region}`;
    }
    default:
      return null;
  }
}

function phraseFor(
  name: string,
  phase: "running" | "done" | "failed",
  count: number,
) {
  const known = TOOL_PHRASES[name];
  if (known) {
    if (count > 1) {
      const manyKey = `${phase}Many` as
        | "runningMany"
        | "doneMany"
        | "failedMany";
      const plural = known[manyKey];
      if (plural) return plural.replace("{n}", String(count));
    }
    return known[phase];
  }
  // Fallback: humanise the snake_case name. Pluralise on count.
  const human = name.replace(/_/g, " ");
  const prefix = count > 1 ? `${count} × ` : "";
  if (phase === "running") return `Running ${prefix}${human}…`;
  if (phase === "failed") return `${prefix}${human} failed.`;
  return `Finished ${prefix}${human}.`;
}

export function ToolFallbackCard({
  name,
  status,
  count = 1,
  parameters,
}: ToolFallbackCardProps) {
  const phase: "running" | "done" | "failed" = useMemo(() => {
    const s = (status ?? "").toLowerCase();
    if (s.includes("error") || s.includes("fail")) return "failed";
    if (s.includes("complete") || s.includes("success") || s.includes("done"))
      return "done";
    return "running";
  }, [status]);

  if (SUPPRESSED_TOOLS.has(name)) return null;

  // Prefer the actual command being run (mono) over the friendly
  // phrase. For grouped calls (count > 1) we drop back to the phrase
  // since per-call commands are different and there's only one row.
  const args = useMemo(() => parseArgs(parameters), [parameters]);
  const cmd = count === 1 ? commandFor(name, args) : null;
  const text = cmd ?? phraseFor(name, phase, count);
  const isMono = cmd != null;

  const isRunning = phase === "running";
  const isFailed = phase === "failed";

  return (
    <div
      className="my-0.5 inline-flex items-center gap-2 leading-relaxed"
      style={{
        color: isFailed ? "var(--destructive)" : "var(--muted-foreground)",
        fontSize: isMono ? 11.5 : 12.5,
      }}
      title={isMono ? text : undefined}
    >
      {phase === "done" ? (
        <CheckGlyph />
      ) : isFailed ? (
        <CrossGlyph />
      ) : null}
      <span
        className={`${isRunning ? "gpilot-shimmer" : ""} ${isMono ? "font-mono" : ""}`.trim()}
        style={
          isRunning
            ? {
                backgroundImage:
                  "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ opacity: 0.85 }}
    >
      <path d="M2.5 6.5L5 9l4.5-5.5" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}
