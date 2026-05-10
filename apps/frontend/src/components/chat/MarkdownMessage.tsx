"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import ShikiHighlighter, {
  isInlineCode,
  type Element as ShikiElement,
} from "react-shiki/web";

/**
 * Render an assistant chat message as GitHub-Flavored Markdown.
 *
 * - `remark-gfm` adds tables, strikethrough, autolinks, task lists, footnotes.
 * - Code fences are syntax-highlighted with Shiki (web bundle, dual theme).
 * - Raw HTML is escaped by react-markdown's default (no `rehype-raw`), so
 *   model output can never inject DOM.
 *
 * Tool calls are rendered separately by `ChatMessages` (above the markdown
 * body in the same bubble) — this component never touches them.
 */

interface MarkdownMessageProps {
  content: string;
}

// Memoized so streaming token deltas only re-render when `content` changes
// (the parent rebuilds the bubble on every state tick).
function MarkdownMessageImpl({ content }: MarkdownMessageProps) {
  return (
    <div className="gpilot-prose text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageImpl);

const LANGUAGE_RE = /language-(\w+)/;

// `react-markdown` v9 dropped the legacy `inline` prop on `code`. We use
// `isInlineCode` (from react-shiki) to detect inline code spans vs. fenced
// blocks via the HAST node, then render accordingly.
const MARKDOWN_COMPONENTS: Components = {
  code({ className, children, node, ...props }) {
    const raw = String(children ?? "");
    const match = className?.match(LANGUAGE_RE);
    const language = match?.[1];
    // Cast through `unknown` because react-markdown and react-shiki both
    // ship `@types/hast` from different paths. The runtime shape is identical.
    const inline = node ? isInlineCode(node as unknown as ShikiElement) : false;

    if (inline) {
      return (
        <code
          className="rounded px-1 py-0.5 font-mono text-[0.875em]"
          style={{
            background: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          }}
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <ShikiHighlighter
        language={language ?? "text"}
        theme={{ light: "github-light", dark: "github-dark" }}
        defaultColor="light"
        showLanguage={Boolean(language)}
        delay={150}
        addDefaultStyles={false}
        className="gpilot-codeblock"
      >
        {raw.replace(/\n$/, "")}
      </ShikiHighlighter>
    );
  },

  p({ children }) {
    return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
  },

  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-1 underline-offset-2"
        style={{ color: "var(--foreground)" }}
      >
        {children}
      </a>
    );
  },

  h1({ children }) {
    return (
      <h1 className="mt-4 mb-2 text-[1.35em] font-semibold first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mt-4 mb-2 text-[1.2em] font-semibold first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mt-3 mb-1.5 text-[1.08em] font-semibold first:mt-0">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mt-3 mb-1.5 text-[1em] font-semibold first:mt-0">
        {children}
      </h4>
    );
  },

  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },

  blockquote({ children }) {
    return (
      <blockquote
        className="my-2 border-l-2 pl-3 italic"
        style={{
          borderColor: "var(--border)",
          color: "var(--muted-foreground)",
        }}
      >
        {children}
      </blockquote>
    );
  },

  hr() {
    return (
      <hr
        className="my-3"
        style={{ borderColor: "var(--border)" }}
      />
    );
  },

  // GFM tables — wrap in an overflow container so wide tables don't blow
  // out the bubble width.
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table
          className="w-full border-collapse text-[0.92em]"
          style={{ borderColor: "var(--border)" }}
        >
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return (
      <thead style={{ background: "var(--surface-sunken)" }}>{children}</thead>
    );
  },
  th({ children }) {
    return (
      <th
        className="px-2.5 py-1.5 text-left font-semibold"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td
        className="px-2.5 py-1.5 align-top"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {children}
      </td>
    );
  },

  // GFM task list checkboxes
  input({ type, checked, disabled }) {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          disabled={disabled ?? true}
          readOnly
          className="mr-1.5 translate-y-px accent-current"
        />
      );
    }
    return null;
  },

  // Bare `pre` passthrough — Shiki produces its own styled `<pre>` for
  // fenced blocks via the `code` component above.
  pre({ children }) {
    return <>{children}</>;
  },
};
