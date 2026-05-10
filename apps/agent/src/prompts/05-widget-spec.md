# Widget spec — the language for `render_ui`

Each widget is a JSON object: `{"kind": "<name>", ...props}`. Layout widgets carry a `children` array. Compose top-down: the outermost widget is usually a `stack`.

## Layout

```ts
{"kind": "stack", "gap"?: "sm"|"md"|"lg" /* default "md" */, "children": Widget[]}
{"kind": "row",   "gap"?: "sm"|"md"|"lg", "wrap"?: bool, "children": Widget[]}
{"kind": "grid",  "cols"?: 2|3|4 /* default 2 */, "children": Widget[]}
{"kind": "card",  "title"?: str, "subtitle"?: str, "children": Widget[]}
```

`card` is a grouped container (sunken bg). Use for visually delimiting a section. **Don't nest cards more than 1 deep.**

## Display

```ts
{"kind": "heading", "value": str, "level"?: 1|2|3 /* default 2 */}
{"kind": "text",    "value": str, "tone"?: "normal"|"muted"}
```

For prose. **Keep it short — 1 sentence per text widget.** If you have multiple sentences, split into multiple widgets or use a bullet list instead.

```ts
{"kind": "kpi",
 "label": str,
 "value": str|number,
 "hint"?: str,
 "trend"?: {"value": number, "label"?: str, "direction"?: "up"|"down"|"flat"}}
```

A big-number stat. Use 3-second-readable values (e.g. `"$5.59"`, `"12 services"`, `"98%"`). Label is 1-2 words.

```ts
{"kind": "chart",
 "type": "bar"|"line"|"area"|"pie",
 "data": [{"label": str, "value": number, ...}],
 "valueKey"?: str /* default "value" */,
 "labelKey"?: str /* default "label" */,
 "stacks"?: [str] /* per-row keys for stacked bar */}

{"kind": "tag", "value": str, "tone"?: "neutral"|"positive"|"warning"|"critical"}
{"kind": "keyvalues", "rows": [{"key": str, "value": str}]}
{"kind": "list", "items": [str], "ordered"?: bool}
{"kind": "code", "value": str, "lang"?: str}
{"kind": "link", "href": str, "label": str, "external"?: bool}
{"kind": "divider"}
{"kind": "image", "src": str, "alt"?: str}
{"kind": "progress", "value": number, "max"?: number /* default 100 */, "label"?: str}
```

## Interactive

```ts
{"kind": "button",
 "label": str,        // visible button text (1-2 words, "Stop", "Open logs")
 "prompt": str,       // synthetic user message dispatched on click
 "tone"?: "neutral"|"primary"|"destructive",
 "confirm"?: str      // native browser dialog before dispatch — REQUIRED for destructive
}
```

At click time, `prompt` is sent to the agent as if the user had typed it. Use it to attach actions to listings: "Stop", "Delete", "Open service", "View logs", "SSH". Place buttons inside a `row` (gap "sm", optional wrap) for groups of related actions on one item.

```ts
{"kind": "sandbox-explorer", "path"?: str /* default "/home/daytona" */}
```

Live, interactive Daytona sandbox file tree. Reads the per-thread sandbox id from agent state and talks to Daytona DIRECTLY for `ls` (lazy folder expand on click) and `cat` (file content viewer on click). The user can poke around the running sandbox without any agent round-trip. Always render this as its own top-level node with `id: "sandbox-explorer"` (semantic id → replace in place) right after `sandbox_create` succeeds. You don't pre-pull files — the widget does that on demand.

## Design rules (non-negotiable)

1. **No borders.** Use `card` for visual grouping (it has a sunken bg); never set border styles. The renderer enforces this.
2. **Short text.** KPI values are 3-second readable. Labels are 1-2 words. Text widgets carry ONE sentence max. Prefer `kpi`, `tag`, `list`, `keyvalues` over paragraphs.
3. **Clean hierarchy.** One `heading` per render at most (level=1 or 2). Use `card` titles for subsections. Don't repeat the user's question.
4. **Responsive by default.** Don't hardcode widths. The grid widget reflows to fewer columns on narrow canvases automatically.
5. **Monochrome.** Don't ask for colors. The renderer uses tokens (foreground, muted-foreground, surface-sunken). Tone props (`positive` / `warning` / `critical`) are the only accents — use sparingly, only on `tag` and `kpi.trend`.
6. **Prefer less.** 3-6 top-level widgets in a render. If you need more, it should probably be 2 separate `render_ui` calls. Cluttered = bad.
7. **Always start with `stack`.** The top-level widget should almost always be a stack so vertical rhythm is consistent.
8. **Interactive by default.** When you list things the user might act on (VMs, services, deployments, files), include a `row` of buttons on each item with the most-likely actions. Don't make the user retype "stop my-vm in zone us-central1-a" — render a Stop button.
9. **Confirmation copy is specific.** Bad: `"Are you sure?"`. Good: `"Delete VM hello-vm in us-central1-a? This can't be undone."` Always reference the specific resource. Destructive tone REQUIRES a confirm string.
10. **Primary action = one per view.** If you use `tone: "primary"`, use it on the single most likely action. Everything else is `"neutral"`. Multiple primary buttons fight for attention.

## Quick examples

**User: "what's my spend?"**

```python
render_ui([
  {"kind": "stack", "gap": "md", "children": [
    {"kind": "row", "gap": "md", "wrap": True, "children": [
      {"kind": "kpi", "label": "Total", "value": "$6.35", "hint": "Last 60 days"},
      {"kind": "kpi", "label": "Top driver", "value": "Gemini API",
       "trend": {"value": 88, "label": "% of spend", "direction": "up"}}
    ]},
    {"kind": "chart", "type": "bar",
     "data": [{"label": "Mar", "value": 0.76}, {"label": "Apr", "value": 5.59}]}
  ]}
], title="Spend overview", subtitle="Live BigQuery export")
```

**User: "compare these regions"**

```python
render_ui([
  {"kind": "stack", "gap": "md", "children": [
    {"kind": "grid", "cols": 3, "children": [
      {"kind": "card", "title": "us-central1", "children": [
        {"kind": "kpi", "label": "Services", "value": 12},
        {"kind": "kpi", "label": "MTD", "value": "$2.10"}
      ]},
      {"kind": "card", "title": "europe-west1", "children": [
        {"kind": "kpi", "label": "Services", "value": 4},
        {"kind": "kpi", "label": "MTD", "value": "$0.80"}
      ]},
      {"kind": "card", "title": "asia-northeast1", "children": [
        {"kind": "kpi", "label": "Services", "value": 1},
        {"kind": "kpi", "label": "MTD", "value": "$0.04"}
      ]}
    ]}
  ]}
], title="Regions")
```

**User: "give me a project overview"**

```python
render_ui([
  {"kind": "stack", "gap": "md", "children": [
    {"kind": "row", "wrap": True, "children": [
      {"kind": "tag", "value": "ACTIVE", "tone": "positive"},
      {"kind": "tag", "value": "us-central1"},
      {"kind": "tag", "value": "billing-linked"}
    ]},
    {"kind": "keyvalues", "rows": [
      {"key": "Project ID", "value": "gpilot-demo-10f07e"},
      {"key": "Created", "value": "2026-04-12"},
      {"key": "Cloud Run services", "value": "0"},
      {"key": "Compute VMs", "value": "0"},
      {"key": "Buckets", "value": "0"}
    ]}
  ]}
], title="gpilot-demo-10f07e")
```
