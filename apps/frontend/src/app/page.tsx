"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { ChatInput } from "@/components/chat/ChatInput";
import { ThemeProvider } from "@/hooks/use-theme";

const SUGGESTIONS = [
  "Show me last two months of GCP spend",
  "List my resources",
  "What's my biggest cost driver?",
];

const QUEUED_KEY = "gpilot.queuedMessage";

/**
 * Entry point — empty state. Logo + chat input + a few starter chips,
 * vertically centered. No threads drawer, no canvas, no chat panel.
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

function Entry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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
    <main
      className="relative flex min-h-screen flex-col px-6"
      style={{ background: "var(--background)" }}
    >
      {/* Top bar: brand mark on the left, theme toggle on the right */}
      <div className="flex items-center justify-between py-5">
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
        <div className="gpilot-fade-in" style={{ animationDelay: "60ms" }}>
          <ThemeToggle />
        </div>
      </div>

      {/* Centered hero: greeting + input + suggestions */}
      <div className="flex flex-1 items-center justify-center">
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
