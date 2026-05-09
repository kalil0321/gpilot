/**
 * Frontend mirror of `apps/agent/src/gcp_state.py` — keep in sync.
 *
 * The agent emits these shapes via STATE_SNAPSHOT and the React side
 * reads them through `useAgent().state`. Every field is optional on
 * the React side because the backend may emit only the keys it
 * mutated (LangGraph's Command(update=...) is partial).
 */

export type ResourceType =
  | "project"
  | "service"
  | "deployment"
  | "billing_period"
  | "dataset"
  | "bucket";

export interface GCPResource {
  id: string;
  type: ResourceType;
  name: string;
  region?: string;
  status?: string;
  cost_usd_mtd?: number;
  metadata?: Record<string, unknown>;
  last_updated?: string;
}

export interface BillingPeriod {
  /** ISO month, e.g. "2026-04" */
  month: string;
  service: string;
  cost_usd: number;
}

export interface Header {
  title?: string;
  subtitle?: string;
}

export interface SyncMeta {
  /** "gcp" | "mixed" | "seed" — surfaced in the audit footer. */
  source?: string;
  syncedAt?: string;
}

// --- Daytona sandbox shapes ---------------------------------------------

export interface SandboxMeta {
  id?: string;
  status?: "running" | "stopped";
  workspace?: string;
  image?: string;
  started_at?: string;
}

export interface TerminalEntry {
  id: string;
  command: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  duration_ms?: number;
  ts?: string;
}

export interface SandboxFile {
  path: string;
  bytes?: number;
  ts?: string;
  /** "write" | "read" | "clone" — currently only "write" is tracked. */
  kind?: string;
}

export interface SandboxPreview {
  port: number;
  url: string;
  started_at?: string;
}

// --- Agent-generated UI -------------------------------------------------
//
// Mirror of the WIDGET SPEC the agent is taught in the system prompt.
// We accept Record<string, unknown> intentionally — every widget renderer
// validates per-render so a malformed widget shows a placeholder instead
// of crashing the canvas.

export type WidgetSpec = {
  kind: string;
  [k: string]: unknown;
};

// ------------------------------------------------------------------------

export interface AgentState {
  resources: GCPResource[];
  billing_periods: BillingPeriod[];
  selected_resource_id: string | null;
  header?: Header;
  sync?: SyncMeta;
  sandbox?: SandboxMeta;
  terminal_log: TerminalEntry[];
  sandbox_files: SandboxFile[];
  sandbox_preview: SandboxPreview | null;
  dynamic_widgets: WidgetSpec[];
}

/**
 * Defaults the page uses to merge over partial backend snapshots.
 * Keeps consumers from having to null-check `state.resources` etc.
 */
export const initialAgentState: AgentState = {
  resources: [],
  billing_periods: [],
  selected_resource_id: null,
  header: { title: "gpilot", subtitle: "Agentic interface for Google Cloud" },
  sync: {},
  sandbox: undefined,
  terminal_log: [],
  sandbox_files: [],
  sandbox_preview: null,
  dynamic_widgets: [],
};

export function mergeAgentState(raw: unknown): AgentState {
  const partial =
    raw && typeof raw === "object" ? (raw as Partial<AgentState>) : {};
  return {
    ...initialAgentState,
    ...partial,
    resources: partial.resources ?? initialAgentState.resources,
    billing_periods:
      partial.billing_periods ?? initialAgentState.billing_periods,
    header: { ...initialAgentState.header, ...(partial.header ?? {}) },
    sync: { ...initialAgentState.sync, ...(partial.sync ?? {}) },
    selected_resource_id:
      partial.selected_resource_id ?? initialAgentState.selected_resource_id,
    sandbox: partial.sandbox ?? initialAgentState.sandbox,
    terminal_log: partial.terminal_log ?? initialAgentState.terminal_log,
    sandbox_files: partial.sandbox_files ?? initialAgentState.sandbox_files,
    sandbox_preview: partial.sandbox_preview ?? initialAgentState.sandbox_preview,
    dynamic_widgets: partial.dynamic_widgets ?? initialAgentState.dynamic_widgets,
  };
}
