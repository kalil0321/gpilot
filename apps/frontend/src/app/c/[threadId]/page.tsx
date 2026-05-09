"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
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
import { ThemeToggle } from "@/components/brand/ThemeToggle";
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

function ChatColumn({
  threadId,
  canvasOpen,
  onToggleCanvas,
}: {
  threadId: string;
  canvasOpen: boolean;
  onToggleCanvas: () => void;
}) {
  const router = useRouter();
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  const [busy, setBusy] = useState(false);
  const flushedQueueRef = useRef(false);

  // Hydrate the thread's message history on mount / threadId change.
  // CopilotChat does this internally; we have a custom chat surface so
  // we must call connectAgent ourselves — without it `agent.messages`
  // stays empty after a page refresh and prior turns are invisible.
  // Pattern mirrored from @copilotkit/react-core/v2/CopilotChat.tsx
  // (the connectAgent block around line 220).
  useEffect(() => {
    if (!agent || !threadId) return;
    let detached = false;
    const ctl = new AbortController();
    // HttpAgent reads from .abortController; setting it lets us cancel
    // the in-flight connect on unmount / threadId change.
    const a = agent as typeof agent & { abortController?: AbortController };
    if ("abortController" in a) {
      a.abortController = ctl;
    }
    a.threadId = threadId as string;
    void copilotkit.connectAgent({ agent }).catch((err: unknown) => {
      if (!detached) console.error("connectAgent failed", err);
    });
    return () => {
      detached = true;
      try {
        ctl.abort();
      } catch {
        // ignore
      }
    };
  }, [agent, threadId, copilotkit]);

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
        className="flex items-center justify-between border-b px-4 py-3"
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
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleCanvas}
            aria-label={canvasOpen ? "Hide canvas" : "Show canvas"}
            className="hidden h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] uppercase tracking-widest transition-colors hover:bg-muted xl:inline-flex"
            style={{ color: "var(--muted-foreground)" }}
            title={canvasOpen ? "Hide canvas" : "Show canvas"}
          >
            <span>canvas</span>
            {canvasOpen ? (
              <ChevronsRight size={14} />
            ) : (
              <ChevronsLeft size={14} />
            )}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <ChatMessages busy={busy} />

      <div className="px-4 pb-3 pt-1">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSubmit={sendMessage} busy={busy} autoFocus />
        </div>
      </div>
    </div>
  );
}

// localStorage keys for per-user UI persistence.
const LS_DRAWER = "gpilot.drawerOpen";
const LS_CANVAS = "gpilot.canvasOpen";
const LS_CANVAS_W = "gpilot.canvasWidth";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function readNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function ChatLayout() {
  const params = useParams<{ threadId: string }>();
  const threadId = params?.threadId;
  const router = useRouter();
  // Drawer + canvas state persist across reloads via localStorage so a
  // user who hides the drawer doesn't have it pop back open every
  // refresh. Defaults: drawer closed, canvas open at 420px.
  const [drawerOpen, setDrawerOpen] = useState(() => readBool(LS_DRAWER, false));
  const [canvasOpen, setCanvasOpen] = useState(() => readBool(LS_CANVAS, true));
  const [canvasWidth, setCanvasWidth] = useState(() => readNum(LS_CANVAS_W, 420));

  // Persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_DRAWER, String(drawerOpen));
    } catch {
      // ignore (private mode etc.)
    }
  }, [drawerOpen]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_CANVAS, String(canvasOpen));
    } catch {
      // ignore
    }
  }, [canvasOpen]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_CANVAS_W, String(canvasWidth));
    } catch {
      // ignore
    }
  }, [canvasWidth]);

  // Cmd+B (Ctrl+B on win/linux) toggles the threads drawer — same
  // shortcut Cursor / VS Code use. We swallow the keystroke so the
  // browser's default "favourites bar" toggle doesn't fire.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdB =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "b";
      if (!isCmdB) return;
      e.preventDefault();
      setDrawerOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <div className="flex">
            <ChatColumn
              threadId={threadId}
              canvasOpen={canvasOpen}
              onToggleCanvas={() => setCanvasOpen((v) => !v)}
            />
            <CanvasPane
              open={canvasOpen}
              width={canvasWidth}
              onResize={setCanvasWidth}
              onContentArrived={() => setCanvasOpen(true)}
            />
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
