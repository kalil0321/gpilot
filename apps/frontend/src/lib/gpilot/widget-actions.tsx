"use client";

import { createContext, useContext } from "react";

/**
 * Bridge between agent-rendered widgets (the canvas) and the chat
 * runtime (the agent). Interactive widgets — buttons, eventually
 * sliders / toggles / forms — call `dispatch(prompt)` to inject a
 * synthetic user message and re-run the agent.
 *
 * It's deliberately "send a prompt" rather than "call a tool
 * directly": we want the agent to stay in the loop so it can confirm
 * destructive intents, recover from errors, and re-render the canvas
 * with fresh state. The latency cost (one LLM round-trip) is fine for
 * the hackathon; we can wire a frontend-tool fast path later.
 */
export interface WidgetActionsContextValue {
  dispatch: (text: string) => void | Promise<void>;
  busy: boolean;
}

const WidgetActionsContext = createContext<WidgetActionsContextValue | null>(
  null,
);

export function WidgetActionsProvider({
  value,
  children,
}: {
  value: WidgetActionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <WidgetActionsContext.Provider value={value}>
      {children}
    </WidgetActionsContext.Provider>
  );
}

export function useWidgetActions(): WidgetActionsContextValue {
  const ctx = useContext(WidgetActionsContext);
  // Fallback so DynamicWidget can render outside a live chat (e.g.
  // inside a storybook preview, or the entry-page hero). Buttons
  // become no-ops in that mode rather than throwing.
  if (!ctx) return { dispatch: () => {}, busy: false };
  return ctx;
}
