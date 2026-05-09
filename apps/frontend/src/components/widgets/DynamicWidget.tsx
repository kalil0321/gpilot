"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, ExternalLink } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WidgetSpec } from "@/lib/gpilot/types";
import { useWidgetActions } from "@/lib/gpilot/widget-actions";

/**
 * Recursive widget renderer for the agent-generated UI surface.
 *
 * Design rules enforced HERE (so the agent literally cannot break them):
 *  - No borders. Visual grouping uses sunken backgrounds.
 *  - Monochrome — accents come from the foreground / muted-foreground
 *    tokens; tone props ("positive"/"warning"/"critical") are the only
 *    way to inject color, and they're scoped to tag + kpi.trend.
 *  - Responsive — every widget is width:100% and reflows; no widget
 *    accepts a width prop.
 *  - Truncation defaults — long text gets clipped at the renderer level
 *    so a chatty agent doesn't sprawl.
 */
export function DynamicWidget({ widget }: { widget: WidgetSpec }) {
  // Invalid widget shape — render nothing rather than a placeholder.
  // The placeholder used to fire on stale or malformed entries (e.g.
  // when the LangGraph fallback loads a thread whose dynamic_widgets
  // array contains nulls or non-object items) and just polluted the
  // canvas. Silent skip is the safer default; per-render warnings stay
  // dev-only.
  if (!widget || typeof widget !== "object" || typeof widget.kind !== "string") {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[gpilot] DynamicWidget skipped invalid spec:", widget);
    }
    return null;
  }
  switch (widget.kind) {
    case "stack":
      return <Stack widget={widget} />;
    case "row":
      return <Row widget={widget} />;
    case "grid":
      return <Grid widget={widget} />;
    case "card":
      return <Card widget={widget} />;
    case "heading":
      return <Heading widget={widget} />;
    case "text":
      return <Text widget={widget} />;
    case "kpi":
      return <Kpi widget={widget} />;
    case "chart":
      return <Chart widget={widget} />;
    case "tag":
      return <Tag widget={widget} />;
    case "keyvalues":
      return <KeyValues widget={widget} />;
    case "list":
      return <ListWidget widget={widget} />;
    case "code":
      return <Code widget={widget} />;
    case "link":
      return <LinkWidget widget={widget} />;
    case "divider":
      return <Divider />;
    case "image":
      return <ImageWidget widget={widget} />;
    case "progress":
      return <Progress widget={widget} />;
    case "button":
      return <ButtonWidget widget={widget} />;
    default:
      return <UnknownWidget kind={String(widget.kind)} />;
  }
}

// ---------- shared helpers --------------------------------------------

const GAP_PX: Record<string, number> = { sm: 6, md: 12, lg: 20 };

function pickGap(g: unknown): number {
  if (typeof g === "string" && g in GAP_PX) return GAP_PX[g];
  return GAP_PX.md;
}

function asString(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function toneColor(tone: unknown): { fg: string; bg: string } {
  switch (tone) {
    case "positive":
      return {
        fg: "color-mix(in oklab, #3ddc84 80%, var(--foreground))",
        bg: "color-mix(in oklab, #3ddc84 14%, var(--surface-sunken))",
      };
    case "warning":
      return {
        fg: "color-mix(in oklab, #f5a524 85%, var(--foreground))",
        bg: "color-mix(in oklab, #f5a524 14%, var(--surface-sunken))",
      };
    case "critical":
      return {
        fg: "var(--destructive)",
        bg: "color-mix(in oklab, var(--destructive) 14%, var(--surface-sunken))",
      };
    default:
      return {
        fg: "var(--muted-foreground)",
        bg: "var(--surface-sunken)",
      };
  }
}

// ---------- layout primitives -----------------------------------------

function Stack({ widget }: { widget: WidgetSpec }) {
  const gap = pickGap(widget.gap);
  const children = asArray<WidgetSpec>(widget.children);
  return (
    <div className="flex w-full flex-col" style={{ gap }}>
      {children.map((c, i) => (
        <DynamicWidget key={i} widget={c} />
      ))}
    </div>
  );
}

function Row({ widget }: { widget: WidgetSpec }) {
  const gap = pickGap(widget.gap);
  const wrap = widget.wrap === true;
  const children = asArray<WidgetSpec>(widget.children);
  return (
    <div
      className="flex w-full"
      style={{ gap, flexWrap: wrap ? "wrap" : "nowrap" }}
    >
      {children.map((c, i) => (
        <div key={i} className="min-w-0 flex-1">
          <DynamicWidget widget={c} />
        </div>
      ))}
    </div>
  );
}

function Grid({ widget }: { widget: WidgetSpec }) {
  const cols = Math.max(1, Math.min(4, asNumber(widget.cols, 2)));
  const children = asArray<WidgetSpec>(widget.children);
  // Container queries would be ideal but the canvas pane width is
  // tracked in JS so we can use a media-query-free auto-fit:
  // minmax(min(<auto>, 220px), 1fr) collapses to 1col on narrow.
  return (
    <div
      className="grid w-full"
      style={{
        gap: GAP_PX.md,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`,
        // Cap to N max columns even if there's room
        gridTemplateRows: "auto",
      }}
      data-cols={cols}
    >
      {children.map((c, i) => (
        <DynamicWidget key={i} widget={c} />
      ))}
    </div>
  );
}

function Card({ widget }: { widget: WidgetSpec }) {
  const title = asString(widget.title);
  const subtitle = asString(widget.subtitle);
  const children = asArray<WidgetSpec>(widget.children);
  return (
    <section
      className="w-full rounded-md"
      style={{
        background: "var(--surface-sunken)",
        padding: "14px 14px",
      }}
    >
      {(title || subtitle) && (
        <header className="mb-2.5 flex flex-col gap-0.5">
          {title ? (
            <span
              className="text-[13px] font-medium leading-tight"
              style={{ color: "var(--foreground)" }}
            >
              {title}
            </span>
          ) : null}
          {subtitle ? (
            <span
              className="text-[11.5px] leading-tight"
              style={{ color: "var(--muted-foreground)" }}
            >
              {subtitle}
            </span>
          ) : null}
        </header>
      )}
      <div className="flex flex-col" style={{ gap: GAP_PX.md }}>
        {children.map((c, i) => (
          <DynamicWidget key={i} widget={c} />
        ))}
      </div>
    </section>
  );
}

// ---------- display atoms ---------------------------------------------

function Heading({ widget }: { widget: WidgetSpec }) {
  const value = asString(widget.value);
  const level = Math.max(1, Math.min(3, asNumber(widget.level, 2)));
  const sizeMap: Record<number, string> = {
    1: "text-lg font-semibold",
    2: "text-[15px] font-semibold",
    3: "text-[12.5px] font-semibold uppercase tracking-wide",
  };
  const className = `m-0 leading-tight ${sizeMap[level]}`;
  const color =
    level === 3 ? "var(--muted-foreground)" : "var(--foreground)";
  if (level === 1) return <h1 className={className} style={{ color }}>{value}</h1>;
  if (level === 2) return <h2 className={className} style={{ color }}>{value}</h2>;
  return <h3 className={className} style={{ color }}>{value}</h3>;
}

function Text({ widget }: { widget: WidgetSpec }) {
  const value = asString(widget.value);
  const tone = widget.tone === "muted" ? "muted" : "normal";
  return (
    <p
      className="m-0 text-[13px] leading-relaxed"
      style={{
        color: tone === "muted" ? "var(--muted-foreground)" : "var(--foreground)",
        // Soft cap so a chatty agent doesn't sprawl. Users still see
        // the full string via tooltip.
        display: "-webkit-box",
        WebkitLineClamp: 4,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden",
      }}
      title={value}
    >
      {value}
    </p>
  );
}

function Kpi({ widget }: { widget: WidgetSpec }) {
  const label = asString(widget.label);
  const value = widget.value;
  const hint = asString(widget.hint);
  const trend = widget.trend as
    | { value?: number; label?: string; direction?: "up" | "down" | "flat" }
    | undefined;
  const trendDir = trend?.direction;
  const trendIcon =
    trendDir === "up" ? <ArrowUpRight size={11} /> :
    trendDir === "down" ? <ArrowDownRight size={11} /> :
    trendDir === "flat" ? <ArrowRight size={11} /> :
    null;
  const trendTone =
    trendDir === "up" ? toneColor("positive") :
    trendDir === "down" ? toneColor("critical") :
    toneColor(undefined);

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-1 rounded-md p-3"
      style={{ background: "var(--surface-sunken)" }}
    >
      <span
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "var(--muted-foreground)" }}
      >
        {label}
      </span>
      <span
        className="truncate text-[20px] font-semibold leading-tight tabular-nums"
        style={{ color: "var(--foreground)" }}
        title={asString(value)}
      >
        {asString(value, "—")}
      </span>
      {(hint || trend) && (
        <div className="flex items-center gap-1.5 text-[11px]">
          {trend ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-medium tabular-nums"
              style={{ background: trendTone.bg, color: trendTone.fg }}
            >
              {trendIcon}
              <span>
                {asNumber(trend.value, 0)}
                {trend.label ? ` ${trend.label}` : "%"}
              </span>
            </span>
          ) : null}
          {hint ? (
            <span style={{ color: "var(--muted-foreground)" }}>{hint}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Chart({ widget }: { widget: WidgetSpec }) {
  const type = asString(widget.type, "bar") as "bar" | "line" | "area" | "pie";
  const data = asArray<Record<string, unknown>>(widget.data);
  const valueKey = asString(widget.valueKey, "value");
  const labelKey = asString(widget.labelKey, "label");
  if (data.length === 0) {
    return (
      <div
        className="grid h-32 place-items-center rounded-md text-[11px]"
        style={{
          background: "var(--surface-sunken)",
          color: "var(--muted-foreground)",
        }}
      >
        no data
      </div>
    );
  }

  const fg = "var(--foreground)";
  const muted = "var(--muted-foreground)";
  const grid = "color-mix(in oklab, var(--foreground) 8%, transparent)";

  return (
    <div
      className="w-full overflow-hidden rounded-md p-2"
      style={{ background: "var(--surface-sunken)", height: 220 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey={labelKey} stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
            <Tooltip {...tooltipProps()} />
            <Line type="monotone" dataKey={valueKey} stroke={fg} strokeWidth={1.5} dot={false} />
          </LineChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="gpilot-area-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fg} stopOpacity={0.28} />
                <stop offset="100%" stopColor={fg} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey={labelKey} stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
            <Tooltip {...tooltipProps()} />
            <Area type="monotone" dataKey={valueKey} stroke={fg} strokeWidth={1.5} fill="url(#gpilot-area-gradient)" />
          </AreaChart>
        ) : type === "pie" ? (
          <PieChart>
            <Tooltip {...tooltipProps()} />
            <Pie data={data} dataKey={valueKey} nameKey={labelKey} innerRadius={32} outerRadius={70} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={`color-mix(in oklab, var(--foreground) ${100 - i * 18}%, var(--surface-sunken))`}
                  stroke="var(--background)"
                  strokeWidth={1}
                />
              ))}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey={labelKey} stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis stroke={muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
            <Tooltip {...tooltipProps()} />
            <Bar dataKey={valueKey} fill={fg} radius={[2, 2, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function tooltipProps() {
  return {
    cursor: { fill: "color-mix(in oklab, var(--foreground) 6%, transparent)" },
    contentStyle: {
      background: "var(--background)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      fontSize: 11,
      padding: "6px 8px",
    },
    labelStyle: { color: "var(--muted-foreground)", marginBottom: 2 },
    itemStyle: { color: "var(--foreground)" },
  } as const;
}

function Tag({ widget }: { widget: WidgetSpec }) {
  const value = asString(widget.value);
  const t = toneColor(widget.tone);
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
      style={{ background: t.bg, color: t.fg }}
    >
      {value}
    </span>
  );
}

function KeyValues({ widget }: { widget: WidgetSpec }) {
  const rows = asArray<{ key?: string; value?: string }>(widget.rows);
  if (rows.length === 0) return null;
  return (
    <dl
      className="m-0 grid w-full"
      style={{
        gridTemplateColumns: "minmax(80px, max-content) 1fr",
        rowGap: 4,
        columnGap: 12,
      }}
    >
      {rows.map((r, i) => (
        <div key={i} className="contents">
          <dt
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: "var(--muted-foreground)" }}
          >
            {asString(r.key)}
          </dt>
          <dd
            className="m-0 truncate text-[12px] tabular-nums"
            style={{ color: "var(--foreground)" }}
            title={asString(r.value)}
          >
            {asString(r.value, "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ListWidget({ widget }: { widget: WidgetSpec }) {
  const items = asArray<unknown>(widget.items).map((it) => asString(it));
  const ordered = widget.ordered === true;
  if (items.length === 0) return null;
  const className = "m-0 flex flex-col gap-1 pl-4 text-[12.5px]";
  if (ordered) {
    return (
      <ol className={className} style={{ color: "var(--foreground)" }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    );
  }
  return (
    <ul className={className} style={{ color: "var(--foreground)" }}>
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

function Code({ widget }: { widget: WidgetSpec }) {
  const value = asString(widget.value);
  return (
    <pre
      className="m-0 max-h-64 overflow-auto rounded-md p-2.5 font-mono text-[11.5px] leading-snug"
      style={{
        background: "var(--surface-sunken)",
        color: "var(--foreground)",
      }}
    >
      {value}
    </pre>
  );
}

function LinkWidget({ widget }: { widget: WidgetSpec }) {
  const href = asString(widget.href);
  const label = asString(widget.label, href);
  const external = widget.external !== false;
  if (!href) return null;
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-muted"
      style={{ color: "var(--foreground)", background: "var(--surface-sunken)" }}
    >
      <span className="truncate">{label}</span>
      {external ? <ExternalLink size={11} /> : null}
    </a>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="h-px w-full"
      style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)" }}
    />
  );
}

function ImageWidget({ widget }: { widget: WidgetSpec }) {
  const src = asString(widget.src);
  const alt = asString(widget.alt);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className="block w-full rounded-md"
      style={{ background: "var(--surface-sunken)" }}
    />
  );
}

function Progress({ widget }: { widget: WidgetSpec }) {
  const value = asNumber(widget.value, 0);
  const max = asNumber(widget.max, 100);
  const label = asString(widget.label);
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex w-full flex-col gap-1">
      {label ? (
        <div className="flex items-baseline justify-between text-[11px]">
          <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
          <span className="tabular-nums" style={{ color: "var(--foreground)" }}>
            {Math.round(pct)}%
          </span>
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-sunken)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--foreground)" }}
        />
      </div>
    </div>
  );
}

function ButtonWidget({ widget }: { widget: WidgetSpec }) {
  const label = asString(widget.label, "Action");
  const prompt = asString(widget.prompt);
  const confirmText = asString(widget.confirm);
  const tone = (widget.tone as "neutral" | "primary" | "destructive" | undefined) ?? "neutral";
  const { dispatch, busy } = useWidgetActions();

  const onClick = () => {
    if (!prompt) return;
    if (confirmText && typeof window !== "undefined") {
      if (!window.confirm(confirmText)) return;
    }
    void dispatch(prompt);
  };

  // Tone styling. Borders never appear — fills only.
  const styles: Record<string, React.CSSProperties> = {
    neutral: {
      background: "var(--surface-sunken)",
      color: "var(--foreground)",
    },
    primary: {
      background: "var(--foreground)",
      color: "var(--background)",
    },
    destructive: {
      background:
        "color-mix(in oklab, var(--destructive) 14%, var(--surface-sunken))",
      color: "var(--destructive)",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !prompt}
      title={prompt || undefined}
      className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-[11.5px] font-medium leading-none transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
      style={styles[tone]}
    >
      {label}
    </button>
  );
}

function UnknownWidget({ kind }: { kind: string }) {
  return (
    <div
      className="rounded-md p-2 text-[11px]"
      style={{
        background: "var(--surface-sunken)",
        color: "var(--muted-foreground)",
      }}
    >
      unknown widget: <code>{kind}</code>
    </div>
  );
}
