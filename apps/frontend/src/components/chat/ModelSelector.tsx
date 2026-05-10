"use client";

import { useCallback, useEffect, useMemo, useState, type SVGProps } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Provider names mirror what `langchain.chat_models.init_chat_model`
// expects — keep in lockstep with `apps/agent/src/runtime.py::SUPPORTED_MODELS`.
type ModelProvider = "google_genai" | "anthropic" | "openai";
type ModelGroup = "google" | "anthropic" | "openai";

export type ModelOption = {
  value: string;            // model id (= what we ship to the agent)
  label: string;            // visible label
  group: ModelGroup;
  provider: ModelProvider;  // what the agent reads to dispatch
};

export const MODEL_OPTIONS: readonly ModelOption[] = [
  // Google — rolling latest aliases (auto-track newest stable per tier).
  { value: "gemini-flash-lite-latest", label: "Gemini Flash Lite",
    group: "google", provider: "google_genai" },
  { value: "gemini-flash-latest", label: "Gemini Flash",
    group: "google", provider: "google_genai" },
  { value: "gemini-pro-latest", label: "Gemini Pro",
    group: "google", provider: "google_genai" },
  // Anthropic — Claude 4.x.
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6",
    group: "anthropic", provider: "anthropic" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7",
    group: "anthropic", provider: "anthropic" },
  // OpenAI — GPT-5.x.
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex",
    group: "openai", provider: "openai" },
  { value: "gpt-5.4", label: "GPT-5.4",
    group: "openai", provider: "openai" },
] as const;

/** Default model on first load. Match the backend's `DEFAULT_MODEL`. */
export const DEFAULT_MODEL_VALUE = "gemini-flash-lite-latest";

const LS_KEY = "gpilot.selectedModel";

/**
 * Hook that reads/writes the user's model selection. Backed by
 * localStorage so the choice survives reloads and is shared across
 * pages (entry + chat thread).
 *
 * `option` is the resolved `ModelOption` — call `option.provider` and
 * `option.value` when shipping to the backend via
 * `forwardedProps.config.configurable`.
 */
export function useSelectedModel() {
  const [value, setValueRaw] = useState<string>(DEFAULT_MODEL_VALUE);

  // Hydrate from localStorage on mount. We can't read it during the
  // first render because we need SSR-safe init, so a brief flash to
  // the default is acceptable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(LS_KEY);
      if (stored && MODEL_OPTIONS.some((m) => m.value === stored)) {
        setValueRaw(stored);
      }
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }, []);

  const setValue = useCallback((next: string) => {
    setValueRaw(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const option = useMemo(
    () =>
      MODEL_OPTIONS.find((m) => m.value === value) ??
      MODEL_OPTIONS.find((m) => m.value === DEFAULT_MODEL_VALUE) ??
      MODEL_OPTIONS[0],
    [value],
  );

  return { value, setValue, option };
}

// --- brand icons ---------------------------------------------------------

// Official brand SVG paths sourced from simple-icons (https://simpleicons.org).
const GEMINI_PATH =
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81";

const CLAUDE_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";

// OpenAI flower-knot mark from simple-icons.
const OPENAI_PATH =
  "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z";

function GeminiIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const gradientId = "gemini-brand-gradient";
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <title>Google Gemini</title>
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="3"
          x2="22"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#1C7DFF" />
          <stop offset="0.45" stopColor="#5587FB" />
          <stop offset="0.78" stopColor="#9168F2" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d={GEMINI_PATH} fill={`url(#${gradientId})`} />
    </svg>
  );
}

function ClaudeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <title>Anthropic Claude</title>
      <path d={CLAUDE_PATH} fill="#D97757" />
    </svg>
  );
}

function OpenAIIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <title>OpenAI</title>
      <path d={OPENAI_PATH} fill="currentColor" />
    </svg>
  );
}

const BRAND_ICONS: Record<ModelGroup, (p: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  google: GeminiIcon,
  anthropic: ClaudeIcon,
  openai: OpenAIIcon,
};

const GROUP_LABELS: Record<ModelGroup, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

interface ModelSelectorProps {
  disabled?: boolean;
  /** Fits the in-chat toolbar vs the larger landing input. */
  variant?: "default" | "lg";
  className?: string;
}

/**
 * Model picker with brand glyphs. Wired to `useSelectedModel` so the
 * user's choice persists in localStorage and propagates to every
 * `runAgent` call (via `forwardedProps.config.configurable.agent_model`
 * — see `apps/agent/src/runtime.py`).
 */
export function ModelSelector({
  disabled,
  variant = "default",
  className,
}: ModelSelectorProps) {
  const isLg = variant === "lg";
  const { value, setValue } = useSelectedModel();

  const grouped = MODEL_OPTIONS.reduce<Record<ModelGroup, ModelOption[]>>(
    (acc, model) => {
      (acc[model.group] ||= []).push(model);
      return acc;
    },
    {} as Record<ModelGroup, ModelOption[]>,
  );

  const triggerCn = cn(
    "cursor-pointer disabled:cursor-not-allowed",
    "justify-start gap-1.5 border-0 bg-muted/35 font-normal shadow-none ring-0",
    "transition-colors duration-150 ease-out",
    // Generic chevron + filler svgs stay muted/14px; brand glyphs opt out via [data-brand].
    "[&_svg:not([data-brand])]:pointer-events-none [&_svg:not([data-brand])]:ml-px [&_svg:not([data-brand])]:size-[14px] [&_svg:not([data-brand])]:opacity-55",
    "hover:bg-muted hover:[&_*[data-slot=select-value]]:text-foreground",
    "hover:[&_svg:not([data-brand])]:opacity-90",
    "focus-visible:border-0 focus-visible:ring-[3px] focus-visible:ring-ring/45",
    "*:data-[slot=select-value]:text-muted-foreground",
    isLg ? "min-h-9 px-3 text-[13px]" : "h-8 min-h-8 px-2 text-[11.5px]",
  );

  const itemCls =
    "cursor-pointer rounded-md px-3 py-2 text-[13px] leading-snug outline-none ring-0 [&>span.absolute]:hidden";

  return (
    <Select value={value} onValueChange={setValue} disabled={disabled}>
      <SelectTrigger
        size={isLg ? "default" : "sm"}
        className={cn(
          triggerCn,
          "max-w-56 min-w-40 rounded-lg tracking-tight *:data-[slot=select-value]:font-semibold",
          isLg && "max-w-64 [&_svg:not([data-brand])]:size-[15px]",
          className,
        )}
        aria-label="Model"
        style={{
          color: "var(--foreground)",
        }}
      >
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className={cn(
          "z-100 border-0 rounded-xl bg-card text-card-foreground shadow-xl ring-0",
          "[&_*[data-slot=select-scroll-down-button]]:hidden [&_*[data-slot=select-scroll-up-button]]:hidden",
          isLg ? "min-w-52" : "min-w-48",
        )}
        style={{
          background: "var(--card)",
          color: "var(--card-foreground)",
          boxShadow: "0 12px 40px rgb(0 0 0 / 0.12)",
        }}
      >
        {(Object.keys(grouped) as ModelGroup[]).map((group, idx) => {
          const Icon = BRAND_ICONS[group];
          return (
            <div key={group}>
              {idx > 0 ? <div aria-hidden className="h-2 shrink-0" /> : null}
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest">
                  <Icon data-brand="true" className="size-3" />
                  {GROUP_LABELS[group]}
                </SelectLabel>
                {grouped[group].map((m) => (
                  <SelectItem
                    key={m.value}
                    value={m.value}
                    textValue={m.label}
                    className={itemCls}
                  >
                    <span className="flex items-center gap-2">
                      <Icon
                        data-brand="true"
                        className={cn(isLg ? "size-4" : "size-3.5")}
                      />
                      {m.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}
