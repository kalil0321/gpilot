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
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { WidgetActionsProvider } from "@/lib/gpilot/widget-actions";

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

/**
 * Best-effort detector for "this thread URL is unusable" errors —
 * either the thread was deleted (404 / THREAD_NOT_FOUND) or the
 * threadId is malformed (400 / VALIDATION_ERROR). Both cases mean
 * the user should be bounced back to entry rather than left on a
 * page that keeps spamming the BFF.
 *
 * The error surfaces via two different layers depending on how the
 * BFF wraps it (PlatformRequestError vs raw fetch reject), so we
 * sniff multiple shapes: HTTP status code, plus a message-substring
 * fallback for cases where status got dropped during JSON-stringify.
 *
 * We deliberately do NOT redirect on generic network failures
 * (LangGraph down, BFF unreachable, fetch failed) — those are
 * transient and the user should see the broken state, not get
 * bounced without context.
 */
function isUnusableThreadError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null) {
    const anyErr = err as { status?: number; message?: string };
    if (anyErr.status === 404 || anyErr.status === 400) return true;
    const msg = anyErr.message ?? "";
    if (
      msg.includes("THREAD_NOT_FOUND") ||
      msg.includes("Thread not found") ||
      msg.includes("VALIDATION_ERROR")
    ) {
      return true;
    }
  }
  return false;
}

function ChatColumn({
  busy,
  connecting,
  onSubmit,
  canvasOpen,
  onToggleCanvas,
}: {
  busy: boolean;
  connecting: boolean;
  onSubmit: (text: string) => Promise<void> | void;
  canvasOpen: boolean;
  onToggleCanvas: () => void;
}) {
  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <header
        className="flex shrink-0 items-center justify-between px-3"
        style={{
          height: "var(--app-chrome-row-height)",
          background: "var(--background)",
        }}
      >
        <ThemeToggle />
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
        </div>
      </header>

      <ChatMessages busy={busy} connecting={connecting} />

      <div className="px-4 pb-3 pt-1">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSubmit={onSubmit} busy={busy} autoFocus />
        </div>
      </div>
    </div>
  );
}

/**
 * Inner shell that owns all agent state — connect, run, queue-flush,
 * busy. Lives INSIDE `<CopilotChatConfigurationProvider>` so `useAgent`
 * and `useCopilotKit` resolve.
 *
 * sendMessage is exposed two ways:
 *   1. As `onSubmit` to ChatColumn for the chat input.
 *   2. Through `<WidgetActionsProvider>` so interactive widgets on the
 *      canvas (buttons, etc.) can dispatch synthetic prompts when the
 *      user clicks. Both paths share the same `busy` state so a click
 *      while the agent is mid-run is a no-op.
 *
 * We `key={threadId}` this component from the outer ChatLayout so all
 * useState/useRef reset cleanly per-thread (no message bleed, no
 * stuck queue-flush guard).
 */
function ChatLayoutInner({
  threadId,
  canvasOpen,
  onToggleCanvas,
  canvasWidth,
  onCanvasResize,
  onCanvasOpen,
}: {
  threadId: string;
  canvasOpen: boolean;
  onToggleCanvas: () => void;
  canvasWidth: number;
  onCanvasResize: (w: number) => void;
  onCanvasOpen: () => void;
}) {
  const router = useRouter();
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  const [busy, setBusy] = useState(false);
  const [isNewThread] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(QUEUED_KEY) !== null;
    } catch {
      return false;
    }
  });
  const [connecting, setConnecting] = useState(() => !isNewThread);
  const flushedQueueRef = useRef(false);

  // Hydrate the thread's message history on mount.
  //
  // The agent (from useAgent) is a SINGLETON across thread changes;
  // its `messages` array survives the per-thread component. Tools we
  // tried for clearing it had problems:
  //   - `setMessages([])` then `addMessage(msg)`: produces TWO
  //     subscriber-notification IIFEs in flight. Some downstream
  //     consumer (CopilotKit runtime, BFF cache) sees the empty
  //     intermediate state → ships `contents=[]` to Gemini.
  //   - direct `a.messages = []`: doesn't notify subscribers, but
  //     somehow still trips the same race in practice.
  //
  // What works: in sendMessage we use ONE atomic
  // `agent.setMessages([msg])` for the queue-flush path (the synthetic
  // first message of a brand-new thread). One notification, final
  // state correct, no race window.
  //
  // For ongoing chat-input messages we use addMessage (append on top
  // of the loaded history). Cross-thread message bleed for non-queued
  // navigations (e.g. drawer "new chat" button → type directly) is
  // accepted as a minor UX issue: the BACKEND stores per-thread
  // correctly, only the visual chat is affected, and the user can
  // refresh.
  useEffect(() => {
    if (!agent || !threadId) return;
    const a = agent as typeof agent & { abortController?: AbortController };
    a.threadId = threadId as string;

    if (isNewThread) {
      setConnecting(false);
      return;
    }

    let detached = false;
    setConnecting(true);
    const ctl = new AbortController();
    if ("abortController" in a) {
      a.abortController = ctl;
    }
    // Diagnostic logging for the intermittent "history doesn't load on
    // refresh" bug. Remove once we've nailed the cause.
    const t0 = performance.now();
    console.debug("[gpilot:connect] start", {
      threadId,
      hadMessages: (a as typeof a & { messages?: unknown[] }).messages?.length ?? 0,
      hadStateMessages:
        ((a as typeof a & { state?: { messages?: unknown[] } }).state?.messages
          ?.length ?? 0),
    });
    copilotkit
      .connectAgent({ agent })
      .catch((err: unknown) => {
        if (detached) return;
        console.error("connectAgent failed", err);
        if (isUnusableThreadError(err)) router.replace("/");
      })
      .finally(() => {
        if (!detached) setConnecting(false);
        console.debug("[gpilot:connect] settled", {
          threadId,
          ms: Math.round(performance.now() - t0),
          detached,
          messages:
            (a as typeof a & { messages?: unknown[] }).messages?.length ?? 0,
          stateMessages:
            ((a as typeof a & { state?: { messages?: unknown[] } }).state
              ?.messages?.length ?? 0),
        });
      });
    return () => {
      detached = true;
      try {
        ctl.abort();
      } catch {
        // ignore
      }
    };
  }, [agent, threadId, copilotkit, isNewThread, router]);

  const sendMessage = useCallback(
    async (text: string, opts?: { replaceHistory?: boolean }) => {
      if (!agent || !text.trim() || busy) return;
      setBusy(true);
      try {
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `msg-${Date.now()}`;
        const userMsg = { id, role: "user" as const, content: text };
        if (opts?.replaceHistory) {
          // Queue-flush path: thread is brand-new, agent.messages may
          // still hold the previous thread's history (singleton). Wipe
          // and seed the array atomically — one subscriber notification
          // with the FINAL [user_msg] state, no clear-then-add race.
          (agent as typeof agent & { setMessages: (m: unknown[]) => void })
            .setMessages([userMsg]);
        } else {
          agent.addMessage(userMsg);
        }
        await copilotkit.runAgent({ agent });
      } catch (err) {
        console.error("runAgent failed", err);
        if (isUnusableThreadError(err)) router.replace("/");
      } finally {
        setBusy(false);
      }
    },
    [agent, busy, copilotkit, router],
  );

  // Flush any queued message from the entry-page mount. Gated on
  // `!connecting` so we never race connectAgent's STATE_SNAPSHOT.
  useEffect(() => {
    if (flushedQueueRef.current) return;
    if (!agent || connecting) return;
    let queued: string | null = null;
    try {
      queued = sessionStorage.getItem(QUEUED_KEY);
      if (queued) sessionStorage.removeItem(QUEUED_KEY);
    } catch {
      // ignore
    }
    if (queued) {
      flushedQueueRef.current = true;
      // replaceHistory=true: this is the very first message of a
      // brand-new thread, so seed agent.messages atomically rather
      // than appending onto whatever the singleton was carrying from
      // a prior thread.
      void sendMessage(queued, { replaceHistory: true });
    }
  }, [agent, connecting, sendMessage]);

  return (
    <WidgetActionsProvider value={{ dispatch: sendMessage, busy }}>
      <div className="flex">
        <ChatColumn
          busy={busy}
          connecting={connecting}
          onSubmit={sendMessage}
          canvasOpen={canvasOpen}
          onToggleCanvas={onToggleCanvas}
        />
        <CanvasPane
          open={canvasOpen}
          width={canvasWidth}
          onResize={onCanvasResize}
          onContentArrived={onCanvasOpen}
        />
      </div>
    </WidgetActionsProvider>
  );
}

// localStorage keys for per-user UI persistence.
const LS_DRAWER = "gpilot.drawerOpen";
const LS_CANVAS = "gpilot.canvasOpen";
const LS_CANVAS_W = "gpilot.canvasWidth";

/**
 * Standard UUID shape (v1-v5, including v4 from crypto.randomUUID).
 * 8-4-4-4-12 hex with the canonical hyphen layout.
 *
 * We validate the URL-supplied threadId against this BEFORE mounting
 * the chat surface because Intelligence Platform's connect endpoint
 * rejects malformed ids with a 400 VALIDATION_ERROR — but the error
 * is logged inside CopilotKit without rejecting the connect promise,
 * so our server-side catch never fires. Front-side validation is the
 * only reliable bouncer.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Bail out on missing or malformed threadIds before mounting the
  // chat surface. CopilotKit's connect endpoint logs the resulting
  // VALIDATION_ERROR but doesn't reject the promise we awaited, so
  // server-side catches don't fire — front-side validation is the
  // only reliable bouncer.
  useEffect(() => {
    if (!threadId) return;
    if (!UUID_RE.test(threadId)) {
      router.replace("/");
    }
  }, [threadId, router]);

  if (!threadId || !UUID_RE.test(threadId)) return null;

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
          {/* Keying ChatLayoutInner forces fresh useState/useRef per
              thread — kills the "messages bleed across threads" bug
              and resets the queue-flush guard cleanly. */}
          <ChatLayoutInner
            key={threadId}
            threadId={threadId}
            canvasOpen={canvasOpen}
            onToggleCanvas={() => setCanvasOpen((v) => !v)}
            canvasWidth={canvasWidth}
            onCanvasResize={setCanvasWidth}
            onCanvasOpen={() => setCanvasOpen(true)}
          />
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
