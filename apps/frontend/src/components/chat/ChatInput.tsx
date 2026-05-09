"use client";

import { ArrowUp, Plus } from "lucide-react";
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
  /** Visual scale. `lg` is for the entry-point hero; default is for in-chat. */
  size?: "default" | "lg";
}

export interface ChatInputHandle {
  focus: () => void;
}

/**
 * Two-row chat input — Cursor-style card with a textarea on top and a
 * thin toolbar (attach placeholder + send) on the bottom. 16px radius
 * card, hairline border, no pill-rounding, no shadow.
 *
 * Keyboard:
 *   Enter         → submit
 *   Shift+Enter   → newline
 */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      onSubmit,
      busy,
      placeholder = "Type a message…",
      autoFocus,
      suggestions,
      size = "default",
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState("");
    const isLg = size === "lg";

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const resize = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const lineHeight = isLg ? 26 : 22;
      const max = lineHeight * 6;
      el.style.height = Math.min(el.scrollHeight, max) + "px";
    }, [isLg]);

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

    // ----- size-driven class strings ------------------------------------
    const cardCls = isLg
      ? "rounded-2xl border transition-colors focus-within:border-foreground"
      : "rounded-2xl border transition-colors focus-within:border-foreground";

    const textAreaWrapCls = isLg ? "px-5 pt-4 pb-1" : "px-4 pt-3 pb-1";

    const textareaCls = isLg
      ? "w-full resize-none border-0 bg-transparent text-[16px] leading-[26px] outline-none placeholder:opacity-50 disabled:opacity-60"
      : "w-full resize-none border-0 bg-transparent text-[15px] leading-[22px] outline-none placeholder:opacity-50 disabled:opacity-60";

    const toolbarCls = isLg
      ? "flex items-center gap-2 px-3 py-2"
      : "flex items-center gap-2 px-2.5 py-1.5";

    const sendCls = isLg
      ? "ml-auto grid size-9 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30 hover:opacity-80"
      : "ml-auto grid size-7 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30 hover:opacity-80";

    const sendIconSize = isLg ? 18 : 14;

    const attachCls = isLg
      ? "grid size-9 place-items-center rounded-full transition-colors hover:bg-muted disabled:opacity-30"
      : "grid size-7 place-items-center rounded-full transition-colors hover:bg-muted disabled:opacity-30";

    const attachIconSize = isLg ? 18 : 14;

    const pillCls = isLg
      ? "rounded-full border px-4 py-2.5 text-[14px] transition-colors hover:bg-muted hover:border-foreground disabled:opacity-50"
      : "rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:bg-muted hover:border-foreground disabled:opacity-50";

    return (
      <div className="w-full">
        <form
          onSubmit={handleSubmit}
          className={cardCls}
          style={{
            borderColor: "var(--border)",
            background: "var(--card)",
          }}
        >
          <div className={textAreaWrapCls}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={placeholder}
              disabled={busy}
              className={textareaCls}
              style={{ color: "var(--foreground)" }}
            />
          </div>

          <div className={toolbarCls}>
            <button
              type="button"
              aria-label="Attach (coming soon)"
              disabled
              className={attachCls}
              style={{ color: "var(--muted-foreground)" }}
            >
              <Plus size={attachIconSize} strokeWidth={2} />
            </button>

            <button
              type="submit"
              disabled={!value.trim() || busy}
              aria-label="Send"
              className={sendCls}
              style={{
                background: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              <ArrowUp size={sendIconSize} strokeWidth={2.5} />
            </button>
          </div>
        </form>

        {suggestions && suggestions.length > 0 ? (
          <div
            className={
              isLg
                ? "mt-5 flex flex-wrap justify-center gap-2.5"
                : "mt-3 flex flex-wrap justify-center gap-2"
            }
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                disabled={busy}
                className={`gpilot-pill-in ${pillCls}`}
                style={{
                  borderColor: "var(--border)",
                  color: "var(--muted-foreground)",
                  animationDelay: `${300 + i * 80}ms`,
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
