"use client";

import { useEffect, useState } from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";

import { Logo } from "@/components/brand/Logo";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ThemeProvider } from "@/hooks/use-theme";

/**
 * gpilot canvas — Phase 1 placeholder.
 *
 * Mirrors the wrapping structure of the deleted /leads page (ThemeProvider →
 * ClientOnly → ThreadsDrawer + CopilotChatConfigurationProvider + canvas main +
 * CopilotSidebar). Phase 2 fills CanvasInner with billing chart + service
 * cost cards driven by `useAgent().state`.
 */

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

function CanvasInner() {
  return (
    <>
      <main className="relative flex h-screen flex-col overflow-hidden bg-background px-6 py-5">
        <header className="flex items-end justify-between gap-4 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              <Logo />
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Agentic interface for Google Cloud — billing, deploys, DNS.
            </p>
          </div>
        </header>

        <section
          className="mx-auto mt-12 max-w-xl rounded-2xl border border-dashed p-12 text-center"
          style={{
            borderColor: "var(--border)",
            background: "var(--card)",
            color: "var(--muted-foreground)",
          }}
        >
          <p className="text-sm">
            Canvas is empty. Phase 1 scaffold complete; Phase 2 wires GCP
            resource cards driven by agent state.
          </p>
          <p className="mt-2 font-mono text-xs uppercase tracking-widest">
            try the chat anyway — say hi
          </p>
        </section>
      </main>

      <CopilotSidebar
        defaultOpen
        width={420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />
    </>
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
