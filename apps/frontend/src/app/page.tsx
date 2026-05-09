"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { ChatInput } from "@/components/chat/ChatInput";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ThemeProvider } from "@/hooks/use-theme";

const SUGGESTIONS = [
  "Show me my GCP spend",
  "What's running in my project?",
  "Where's my money going?",
  "How much did I spend last month?",
];

const QUEUED_KEY = "gpilot.queuedMessage";
const LS_DRAWER = "gpilot.drawerOpen";

/**
 * Entry point. Logo + chat input + suggestion chips, vertically
 * centered inside the main panel of the standard threads-drawer
 * layout. The drawer reuses the same component as `/c/[threadId]` so
 * thread history is one click away from the start screen.
 *
 * Submit creates a fresh threadId, stashes the typed message in
 * sessionStorage under `gpilot.queuedMessage`, then navigates to
 * /c/[threadId]. The chat page picks up the stash on mount, sends it
 * via the agent, and clears the storage.
 */

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function Entry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Drawer open/closed state — persisted to localStorage with the same
  // key as the chat page, so toggling it on either screen carries over.
  const [drawerOpen, setDrawerOpen] = useState(() => readBool(LS_DRAWER, false));
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_DRAWER, String(drawerOpen));
    } catch {
      // ignore
    }
  }, [drawerOpen]);

  // Cmd+B / Ctrl+B toggles the drawer — same shortcut as the chat page.
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

  const handleSubmit = useCallback(
    (text: string) => {
      if (busy) return;
      setBusy(true);
      const threadId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `thread-${Date.now()}`;
      try {
        sessionStorage.setItem(QUEUED_KEY, text);
      } catch {
        // sessionStorage can fail in strict private modes — degrade
        // gracefully by passing the message via a query param.
      }
      router.push(`/c/${threadId}`);
    },
    [busy, router],
  );

  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={undefined}
        onThreadChange={(next) => {
          if (next !== undefined) router.push(`/c/${next}`);
          // next === undefined ("new chat" from inside drawer) just
          // closes the drawer and stays on entry — we're already on /.
        }}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
      <main
        className={`${drawerStyles.mainPanel} relative flex flex-col`}
        style={{ background: "var(--background)" }}
      >
        {/* Top bar — same chrome row + horizontal padding as the
            drawer's drawerChromeRow so the logo and theme toggle line
            up exactly with the drawer header (PanelLeftOpen icon row
            on the left). */}
        <header
          className="flex shrink-0 items-center justify-between px-3"
          style={{
            height: "var(--app-chrome-row-height)",
            background: "var(--background)",
          }}
        >
          {/* When the drawer is open it shows its own brand mark in
              its chrome row — duplicating the logo here would put two
              "gpilot." marks side-by-side. We hide ours in that
              state. */}
          {drawerOpen ? (
            <span aria-hidden />
          ) : (
            <div
              className="gpilot-fade-in text-[15px]"
              style={{
                color: "var(--foreground)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                animationDelay: "0ms",
              }}
            >
              <Logo />
            </div>
          )}
          <div className="gpilot-fade-in" style={{ animationDelay: "60ms" }}>
            <ThemeToggle />
          </div>
        </header>

        {/* Centered hero: greeting + input + suggestions */}
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex w-full max-w-2xl flex-col items-stretch gap-6 pb-20">
            <h1
              className="gpilot-fade-in text-center text-[28px] tracking-tight sm:text-[32px]"
              style={{
                color: "var(--foreground)",
                fontWeight: 500,
                letterSpacing: "-0.02em",
                animationDelay: "100ms",
              }}
            >
              Where do we start{getGreetingPunctuation()}
            </h1>

            <div
              className="gpilot-fade-in w-full"
              style={{ animationDelay: "180ms" }}
            >
              <ChatInput
                onSubmit={handleSubmit}
                busy={busy}
                autoFocus
                size="lg"
                placeholder="Ask gpilot to fetch billing, list resources, or deploy a service…"
                suggestions={SUGGESTIONS}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Returns "?" for now — keeps the greeting punctuation a single source
 *  of truth so we can swap the line wholesale later. */
function getGreetingPunctuation() {
  return "?";
}

export default function Page() {
  return (
    <ThemeProvider>
      <ClientOnly>
        <Entry />
      </ClientOnly>
    </ThemeProvider>
  );
}
