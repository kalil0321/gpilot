"use client";

import { useMemo } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

import { BillingChartCard } from "@/components/gpilot/BillingChartCard";
import { ResourceCard } from "@/components/gpilot/ResourceCard";
import { mergeAgentState } from "@/lib/gpilot/types";

/**
 * Right-side canvas pane on the chat thread page. Driven by `agent.state`
 * via STATE_SNAPSHOT, populated by backend tools that mutate
 * billing_periods + resources + sync via Command(update={...}).
 *
 * Renders an empty-state copy when no tool has run yet.
 */
export function CanvasPane() {
  const { agent } = useAgent();
  const state = useMemo(() => mergeAgentState(agent?.state), [agent?.state]);

  const hasContent =
    state.billing_periods.length > 0 || state.resources.length > 0;

  return (
    <aside
      className="hidden h-screen w-[420px] flex-col overflow-y-auto border-l xl:flex"
      style={{ borderColor: "var(--border)" }}
    >
      <header
        className="sticky top-0 flex items-center justify-between border-b px-5 py-3"
        style={{
          borderColor: "var(--border)",
          background: "var(--background)",
        }}
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

      <div className="flex-1 px-5 py-5">
        {hasContent ? (
          <div className="space-y-5">
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
            className="flex h-full items-center justify-center text-center text-[12px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            <p>
              The canvas paints here when the agent
              <br />
              fetches billing or lists resources.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
