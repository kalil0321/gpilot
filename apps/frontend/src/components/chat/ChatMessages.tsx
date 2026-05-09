"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";
import { MessageSkeleton } from "./MessageSkeleton";
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

/**
 * Convert one LangGraph-shaped message ({type:"human"|"ai"|"tool",
 * content, tool_calls, ...}) into the AG-UI shape ChatMessages
 * downstream consumers expect ({role, content, toolCalls, ...}).
 *
 * Returns null for unrecognized shapes so the caller can filter them
 * out without crashing.
 */
function toAguiMessage(raw: unknown): AnyMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
    tool_calls?: Array<{
      id: string;
      name: string;
      args: unknown;
      type?: string;
    }>;
    tool_call_id?: string;
    name?: string;
  };
  // Already AG-UI shaped (has `role`)? Pass through.
  if (m.role) return raw as AnyMessage;
  const t = m.type;
  if (!t) return null;
  const role = t === "ai" ? "assistant" : t === "human" ? "user" : t;
  const content =
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content
            .map((c) =>
              typeof c === "object" && c && "text" in c
                ? String((c as { text: string }).text)
                : "",
            )
            .join("")
        : "";
  const result: AnyMessage = {
    id: m.id,
    role,
    content: content || null,
  };
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    result.toolCalls = m.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments:
          typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args ?? {}),
      },
    }));
  }
  if (m.tool_call_id) result.toolCallId = m.tool_call_id;
  if (m.name) result.name = m.name;
  return result;
}

export function ChatMessages({
  busy = false,
  connecting = false,
}: {
  busy?: boolean;
  connecting?: boolean;
}) {
  const { agent } = useAgent();
  // Primary: agent.messages (kept up-to-date by AG-UI events during a
  // run, in AG-UI shape: {role, content, toolCalls}).
  //
  // Fallback: agent.state.messages — the full LangGraph thread state
  // mirrored on the client. Shape there is LangGraph-native:
  // {type:"human"|"ai"|"tool", content, tool_calls}. We need this
  // fallback because connectAgent's history replay goes through the
  // CopilotKit Intelligence Platform WebSocket and silently returns
  // empty in the local dev setup (seed API key, persistence
  // mismatch). STATE_SNAPSHOT events come through the same pipeline
  // and DO populate agent.state with the actual LangGraph state, so
  // we can read the history from there and convert per-message.
  const liveMessages = (agent?.messages ?? []) as AnyMessage[];
  const messages: AnyMessage[] = useMemo(() => {
    if (liveMessages.length > 0) return liveMessages;
    const stateMsgs = (agent?.state as { messages?: unknown[] } | undefined)?.messages;
    if (!Array.isArray(stateMsgs) || stateMsgs.length === 0) return [];
    return stateMsgs.map(toAguiMessage).filter(Boolean) as AnyMessage[];
  }, [liveMessages, agent?.state]);

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

  // Skeleton while CopilotKit's connectAgent is hydrating an existing
  // thread's history and we have nothing to render yet.
  const showSkeleton = connecting && messages.length === 0;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-3"
      style={{ scrollBehavior: "smooth" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col">
        {showSkeleton ? <MessageSkeleton /> : null}
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
          background: "var(--surface-sunken)",
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

// Tools we want totally invisible in chat — the canvas is the answer.
const SILENT_TOOLS = new Set(["render_ui"]);

function AssistantBubble({
  content,
  toolCalls,
  toolResultByCallId,
}: {
  content: string;
  toolCalls: NonNullable<AnyMessage["toolCalls"]> | NonNullable<AnyMessage["tool_calls"]>;
  toolResultByCallId: Map<string, AnyMessage>;
}) {
  // Drop fully-silent tools (e.g. render_ui — the canvas paints the
  // answer, a "Rendered." status row would just be noise). Each
  // remaining call gets its own row showing the actual command being
  // run, so 3 parallel gcloud invocations land as 3 different
  // informative lines (not 3 identical "Ran the gcloud command."
  // lines and not a collapsed "Ran 3 gcloud commands." that hides
  // what was actually done).
  const visibleCalls = toolCalls.filter(
    (tc) => !SILENT_TOOLS.has(tc.function?.name ?? ""),
  );

  const hasContent = content && content.trim().length > 0;
  const hasCalls = visibleCalls.length > 0;
  if (!hasContent && !hasCalls) return null;

  return (
    <div className="self-start max-w-[90%] pb-2 pt-1">
      {visibleCalls.map((tc) => {
        const result = toolResultByCallId.get(tc.id);
        return (
          <ToolFallbackCard
            key={tc.id}
            name={tc.function?.name ?? "tool"}
            status={result ? "complete" : "running"}
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
