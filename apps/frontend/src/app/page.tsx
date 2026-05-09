"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

import { BillingChartCard } from "@/components/gpilot/BillingChartCard";
import { Header } from "@/components/gpilot/Header";
import { ResourceCard } from "@/components/gpilot/ResourceCard";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { mergeAgentState } from "@/lib/gpilot/types";

/**
 * gpilot canvas — Phase 3.
 *
 * Reads `agent.state` via `useAgent()` and renders a Header + chart +
 * resource grid. The agent's `fetch_billing` / `list_resources` backend
 * tools mutate state through `Command(update={...})`; STATE_SNAPSHOT
 * pushes the change here and React re-renders.
 */

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

function CanvasInner() {
  const { agent } = useAgent();
  const state = useMemo(() => mergeAgentState(agent?.state), [agent?.state]);

  // Render every backend tool call inline in the chat — the user can see
  // exactly what the agent is doing during multi-second MCP cold-starts.
  // Without this hook, the chat goes silent for 3-5s while gcloud-mcp /
  // BigQuery MCP boot fresh per call.
  useDefaultRenderTool({
    render: ({ name, status, result, args }) => (
      <ToolFallbackCard
        name={name}
        status={String(status ?? "")}
        result={typeof result === "string" ? result : JSON.stringify(result)}
        parameters={args}
      />
    ),
  });

  const hasContent =
    state.billing_periods.length > 0 || state.resources.length > 0;

  return (
    <>
      <main className="relative flex h-screen flex-col overflow-hidden bg-background px-6 py-5">
        <Header header={state.header ?? {}} sync={state.sync ?? {}} />

        <div className="flex-1 overflow-auto pb-6">
          {hasContent ? (
            <div className="space-y-6">
              {state.billing_periods.length > 0 && (
                <BillingChartCard periods={state.billing_periods} />
              )}

              {state.resources.length > 0 && (
                <section>
                  <h2
                    className="mb-3 font-mono text-[11px] uppercase tracking-widest"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Resources · {state.resources.length}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {state.resources.map((r) => (
                      <ResourceCard key={r.id} resource={r} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </main>

      <CopilotSidebar
        defaultOpen
        width={420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />
    </>
  );
}

function EmptyState() {
  return (
    <section
      className="mx-auto mt-12 max-w-xl rounded-2xl border border-dashed p-12 text-center"
      style={{
        borderColor: "var(--border)",
        background: "var(--card)",
        color: "var(--muted-foreground)",
      }}
    >
      <p className="text-sm">
        Empty canvas. Ask the agent to{" "}
        <span
          className="font-mono text-xs"
          style={{ color: "var(--foreground)" }}
        >
          show me last two months of GCP spend
        </span>{" "}
        or{" "}
        <span
          className="font-mono text-xs"
          style={{ color: "var(--foreground)" }}
        >
          list my resources
        </span>
        .
      </p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-widest">
        Phase 3 — billing + resources vertical
      </p>
    </section>
  );
}

function HomePage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <CanvasInner />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ThemeProvider>
      <ClientOnly>
        <HomePage />
      </ClientOnly>
    </ThemeProvider>
  );
}
