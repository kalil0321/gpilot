"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

import { CanvasPane } from "@/components/chat/CanvasPane";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { Logo } from "@/components/brand/Logo";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ThemeProvider } from "@/hooks/use-theme";

const QUEUED_KEY = "gpilot.queuedMessage";

/**
 * Chat thread page — full custom UI, no CopilotSidebar.
 *
 * Layout:
 *   [ ThreadsDrawer ] [ ChatColumn (messages + input) ] [ CanvasPane ]
 *
 * On mount, if sessionStorage has a `gpilot.queuedMessage` (set by the
 * entry-point `/` when the user types their first message there), we
 * inject it as the user message and run the agent — then clear it so
 * a reload doesn't replay.
 */

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

function ChatColumn() {
  const router = useRouter();
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  const [busy, setBusy] = useState(false);
  const flushedQueueRef = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!agent || !text.trim() || busy) return;
      setBusy(true);
      try {
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `msg-${Date.now()}`;
        agent.addMessage({ id, role: "user", content: text });
        await copilotkit.runAgent({ agent });
      } catch (err) {
        console.error("runAgent failed", err);
      } finally {
        setBusy(false);
      }
    },
    [agent, busy, copilotkit],
  );

  // Flush any queued message from the entry point on mount (one-time).
  useEffect(() => {
    if (flushedQueueRef.current || !agent) return;
    let queued: string | null = null;
    try {
      queued = sessionStorage.getItem(QUEUED_KEY);
      if (queued) sessionStorage.removeItem(QUEUED_KEY);
    } catch {
      // ignore
    }
    if (queued) {
      flushedQueueRef.current = true;
      void sendMessage(queued);
    }
  }, [agent, sendMessage]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <header
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[14px] transition-opacity hover:opacity-80"
          style={{ color: "var(--foreground)" }}
          title="New chat"
        >
          <Logo />
        </button>
      </header>

      <ChatMessages />

      <div
        className="border-t px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mx-auto max-w-3xl">
          <ChatInput onSubmit={sendMessage} busy={busy} autoFocus />
        </div>
      </div>
    </div>
  );
}

function ChatLayout() {
  const params = useParams<{ threadId: string }>();
  const threadId = params?.threadId;
  const router = useRouter();

  if (!threadId) return null;

  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={(next) => {
          if (next === undefined) router.push("/");
          else router.push(`/c/${next}`);
        }}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <div className="flex">
            <ChatColumn />
            <CanvasPane />
          </div>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ThemeProvider>
      <ClientOnly>
        <ChatLayout />
      </ClientOnly>
    </ThemeProvider>
  );
}
