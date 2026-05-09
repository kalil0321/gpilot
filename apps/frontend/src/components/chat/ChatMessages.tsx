"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * Render the AG-UI `agent.messages` array as a chat stream.
 *
 * Roles handled:
 *   user        right-aligned, plain text, hairline-bottom separator
 *   assistant   left-aligned prose, markdown rendered as plain text for now
 *               (we can swap to Streamdown if needed later)
 *   tool        ToolFallbackCard inline status row
 *   system / developer / activity / reasoning  hidden
 *
 * Messages with `tool_calls` (assistant role) get an inline status row
 * per call so the user sees what the agent kicked off.
 */

type AnyMessage = {
  id?: string;
  role?: string;
  content?: string | null;
  /** AG-UI uses camelCase. Older OpenAI-shaped payloads sometimes still
   *  emit `tool_calls`; we accept both for safety. */
  toolCalls?: Array<{
    id: string;
    type?: "function";
    function: { name: string; arguments: string };
  }>;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments?: string };
  }>;
  toolCallId?: string;
  tool_call_id?: string;
  name?: string;
};

export function ChatMessages({ busy = false }: { busy?: boolean }) {
  const { agent } = useAgent();
  const messages = (agent?.messages ?? []) as AnyMessage[];

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom on new messages or content updates.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content, busy]);

  // "Thinking" placeholder shows when the agent is running AND the most
  // recent visible message isn't an assistant turn that already has
  // content (or a streaming tool call). That catches the silent window
  // between user-submit and the first assistant token.
  const lastVisible = [...messages]
    .reverse()
    .find((m) => m.role === "user" || m.role === "assistant");
  const lastIsAssistantWithSomething =
    lastVisible?.role === "assistant" &&
    ((lastVisible.content && lastVisible.content.trim().length > 0) ||
      (lastVisible.toolCalls && lastVisible.toolCalls.length > 0) ||
      (lastVisible.tool_calls && lastVisible.tool_calls.length > 0));
  const showThinking = busy && !lastIsAssistantWithSomething;

  // Build a quick lookup so we can pair each tool message back to its
  // originating assistant toolCall (for the status display).
  const toolResultByCallId = useMemo(() => {
    const map = new Map<string, AnyMessage>();
    for (const m of messages) {
      if (m.role === "tool") {
        const callId = m.toolCallId ?? m.tool_call_id;
        if (callId) map.set(callId, m);
      }
    }
    return map;
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-3"
      style={{ scrollBehavior: "smooth" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col">
        {(() => {
          let userIndex = 0;
          return messages.map((m) => {
            if (
              m.role === "system" ||
              m.role === "developer" ||
              m.role === "reasoning" ||
              m.role === "activity" ||
              m.role === "tool"
            ) {
              return null;
            }
            if (m.role === "user") {
              const isFirst = userIndex === 0;
              userIndex++;
              return (
                <UserBubble
                  key={m.id}
                  content={m.content ?? ""}
                  isFirst={isFirst}
                />
              );
            }
            if (m.role === "assistant") {
              return (
                <AssistantBubble
                  key={m.id}
                  content={m.content ?? ""}
                  toolCalls={m.toolCalls ?? m.tool_calls ?? []}
                  toolResultByCallId={toolResultByCallId}
                />
              );
            }
            return null;
          });
        })()}
        {showThinking ? <ThinkingIndicator /> : null}
      </div>
    </div>
  );
}

function UserBubble({
  content,
  isFirst,
}: {
  content: string;
  isFirst: boolean;
}) {
  return (
    <div
      className="flex justify-end"
      style={{
        marginTop: isFirst ? "0.25rem" : "1rem",
        paddingBottom: "0.25rem",
      }}
    >
      <div
        className="max-w-[80%] rounded-2xl px-3.5 py-2.5"
        style={{
          background: "var(--card)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  toolCalls,
  toolResultByCallId,
}: {
  content: string;
  toolCalls: NonNullable<AnyMessage["toolCalls"]> | NonNullable<AnyMessage["tool_calls"]>;
  toolResultByCallId: Map<string, AnyMessage>;
}) {
  const hasContent = content && content.trim().length > 0;
  const hasCalls = toolCalls.length > 0;
  if (!hasContent && !hasCalls) return null;

  return (
    <div className="self-start max-w-[90%] pb-2 pt-1">
      {/* tool_calls rendered first as inline status rows */}
      {toolCalls.map((tc) => {
        const result = toolResultByCallId.get(tc.id);
        const status = result ? "complete" : "running";
        return (
          <ToolFallbackCard
            key={tc.id}
            name={tc.function?.name ?? "tool"}
            status={status}
            result={typeof result?.content === "string" ? result.content : undefined}
            parameters={tc.function?.arguments}
          />
        );
      })}
      {hasContent ? (
        <p
          className="whitespace-pre-wrap text-[15px] leading-relaxed"
          style={{ color: "var(--foreground)" }}
        >
          {content}
        </p>
      ) : null}
    </div>
  );
}
