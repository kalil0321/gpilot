"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
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
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: "var(--background)" }}
    >
      <div className="flex w-full max-w-2xl flex-col items-center gap-10">
        <div
          className="gpilot-fade-in text-5xl"
          style={{
            color: "var(--foreground)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            animationDelay: "0ms",
          }}
        >
          <Logo />
        </div>

        <div
          className="gpilot-fade-in w-full"
          style={{ animationDelay: "120ms" }}
        >
          <ChatInput
            onSubmit={handleSubmit}
            busy={busy}
            autoFocus
            size="lg"
            placeholder="What do you want to do with your cloud?"
            suggestions={SUGGESTIONS}
          />
        </div>
      </div>
    </main>
  );
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
