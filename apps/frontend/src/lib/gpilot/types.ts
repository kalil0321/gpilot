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
  | "billing_period";

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

export interface AgentState {
  resources: GCPResource[];
  billing_periods: BillingPeriod[];
  selected_resource_id: string | null;
  header?: Header;
  sync?: SyncMeta;
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
  };
}
