import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GCPResource } from "@/lib/gpilot/types";

interface ResourceCardProps {
  resource: GCPResource;
}

/**
 * Compact card for a single GCP resource. Renders all four resource types
 * (Cloud Run service, BigQuery dataset, Cloud Storage bucket, billing
 * roll-up) with type-specific accents — type drives the badge colour and
 * the metadata fields shown.
 */
export function ResourceCard({ resource }: ResourceCardProps) {
  const platform =
    (resource.metadata?.platform as string | undefined) ??
    typeLabel(resource.type);
  const cost = resource.cost_usd_mtd;
  const url = resource.metadata?.url as string | undefined;

  return (
    <Card className="border-0 bg-card shadow-none transition-colors hover:bg-muted">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{resource.name}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              {platform}
              {resource.region ? ` · ${resource.region}` : ""}
            </CardDescription>
          </div>
          <Badge type={resource.type} status={resource.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {typeof cost === "number" && (
          <Row
            label={resource.type === "billing_period" ? "Total" : "MTD spend"}
            value={`$${cost.toFixed(2)}`}
          />
        )}
        {resource.metadata?.revision && (
          <Row
            label="Revision"
            value={String(resource.metadata.revision)}
            mono
          />
        )}
        {resource.metadata?.image && (
          <Row
            label="Image"
            value={truncate(String(resource.metadata.image), 40)}
            mono
          />
        )}
        {typeof resource.metadata?.row_count === "number" && (
          <Row
            label="Rows"
            value={Number(resource.metadata.row_count).toLocaleString()}
          />
        )}
        {typeof resource.metadata?.size_gb === "number" && (
          <Row
            label="Size"
            value={`${resource.metadata.size_gb} GB`}
          />
        )}
        {typeof resource.metadata?.window_months === "number" && (
          <Row
            label="Window"
            value={`${resource.metadata.window_months} month(s)`}
          />
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate pt-1 font-mono text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--muted-foreground)" }}
          >
            {url}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className="text-xs"
        style={{ color: "var(--muted-foreground)" }}
      >
        {label}
      </span>
      <span
        className={mono ? "truncate font-mono text-xs" : "tabular-nums"}
        style={{ color: "var(--foreground)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Badge({
  type,
  status,
}: {
  type: GCPResource["type"];
  status?: string;
}) {
  const palette =
    type === "service"
      ? { bg: "var(--secondary)", fg: "var(--secondary-foreground)" }
      : type === "billing_period"
        ? { bg: "var(--accent)", fg: "var(--accent-foreground)" }
        : { bg: "var(--muted)", fg: "var(--muted-foreground)" };

  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {status ?? typeLabel(type)}
    </span>
  );
}

function typeLabel(type: GCPResource["type"]): string {
  switch (type) {
    case "service":
      return "Service";
    case "deployment":
      return "Deployment";
    case "billing_period":
      return "Billing";
    default:
      return "Resource";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(-(max - 1))}`;
}
