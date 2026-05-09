import { Logo } from "@/components/brand/Logo";
import type { Header as HeaderModel, SyncMeta } from "@/lib/gpilot/types";

interface HeaderProps {
  header: HeaderModel;
  sync: SyncMeta;
}

/**
 * Page header for the gpilot canvas. Logo + title/subtitle on the left;
 * a small mono "source · timestamp" pill on the right so the user can
 * tell at a glance whether they're looking at live GCP data or seed.
 */
export function Header({ header, sync }: HeaderProps) {
  const title = header.title ?? "gpilot";
  const subtitle =
    header.subtitle ?? "Agentic interface for Google Cloud — billing, deploys, DNS.";
  const source = sync.source;
  const syncedAt = sync.syncedAt;

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ color: "var(--foreground)" }}
        >
          <Logo />
        </h1>
        <p
          className="mt-1 text-sm"
          style={{ color: "var(--muted-foreground)" }}
        >
          {title === "gpilot" ? subtitle : `${title} — ${subtitle}`}
        </p>
      </div>

      {(source || syncedAt) && (
        <div
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide"
          style={{ color: "var(--muted-foreground)" }}
        >
          {source && (
            <span
              className="rounded-full border px-2 py-0.5"
              style={{ borderColor: "var(--border)" }}
            >
              source · {source}
            </span>
          )}
          {syncedAt && (
            <span className="tabular-nums">{formatTime(syncedAt)}</span>
          )}
        </div>
      )}
    </header>
  );
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const diffSec = Math.round((Date.now() - t.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(t);
}
