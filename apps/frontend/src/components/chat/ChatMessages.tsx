"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";

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

export function ChatMessages() {
  const { agent } = useAgent();
  const messages = (agent?.messages ?? []) as AnyMessage[];

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom on new messages or content updates.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

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
      className="flex-1 overflow-y-auto px-6 py-6"
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
      className="self-end max-w-[85%] py-4"
      style={{
        borderTop: isFirst ? undefined : "1px solid var(--border)",
        marginTop: isFirst ? undefined : "0.75rem",
        paddingTop: isFirst ? "0.75rem" : "1.5rem",
        width: "100%",
      }}
    >
      <p
        className="whitespace-pre-wrap text-right text-[15px] leading-relaxed"
        style={{ color: "var(--foreground)" }}
      >
        {content}
      </p>
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
    <div className="self-start max-w-[90%] py-3">
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
