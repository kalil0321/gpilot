"use client";

import { ArrowUp } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

interface ChatInputProps {
  /** Called with the typed message when the user submits. */
  onSubmit: (value: string) => void;
  /** Whether the agent is currently running — disables submit. */
  busy?: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
  /** Optional starter suggestions, rendered below the input. Click → submits. */
  suggestions?: string[];
}

export interface ChatInputHandle {
  focus: () => void;
}

/**
 * Custom chat input — pill-shaped textarea with autoresize and a send
 * button on the right. Keyboard:
 *   Enter         → submit
 *   Shift+Enter   → newline
 * No styled-jsx, no CopilotKit dependency. Pure React + Tailwind.
 */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    { onSubmit, busy, placeholder = "Type a message…", autoFocus, suggestions },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState("");

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    // Autoresize the textarea: shrink to the natural content height,
    // capped at ~6 lines.
    const resize = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const lineHeight = 22;
      const max = lineHeight * 6;
      el.style.height = Math.min(el.scrollHeight, max) + "px";
    }, []);

    useEffect(() => {
      resize();
    }, [value, resize]);

    useEffect(() => {
      if (autoFocus) textareaRef.current?.focus();
    }, [autoFocus]);

    const submit = useCallback(
      (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed || busy) return;
        onSubmit(trimmed);
        setValue("");
      },
      [busy, onSubmit],
    );

    const handleSubmit = (e: FormEvent) => {
      e.preventDefault();
      submit(value);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit(value);
      }
    };

    return (
      <div className="w-full">
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 rounded-3xl border px-4 py-2.5 transition-colors focus-within:border-foreground"
          style={{
            borderColor: "var(--border)",
            background: "var(--background)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={placeholder}
            disabled={busy}
            className="flex-1 resize-none border-0 bg-transparent text-[15px] leading-[22px] outline-none placeholder:opacity-50 disabled:opacity-60"
            style={{ color: "var(--foreground)" }}
          />
          <button
            type="submit"
            disabled={!value.trim() || busy}
            aria-label="Send"
            className="grid size-8 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30 hover:opacity-80"
            style={{
              background: "var(--foreground)",
              color: "var(--background)",
            }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </form>

        {suggestions && suggestions.length > 0 ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                disabled={busy}
                className="rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--muted-foreground)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
);
