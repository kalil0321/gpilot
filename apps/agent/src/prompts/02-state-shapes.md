# Canvas state shapes

These are the slots the canvas reads. Match field names exactly when you populate them via tool calls.

## Resources slot

```ts
resources: GCPResource[]

GCPResource = {
  id: string             // 'service:<region>/<name>' for Cloud Run; 'vm:<zone>/<name>' for VMs; 'bucket:<name>' for GCS
  type: 'project' | 'service' | 'deployment' | 'billing_period'
  name: string
  region?: string
  status?: string        // type-specific (e.g. 'live', 'running', 'active')
  cost_usd_mtd?: number  // month-to-date cost in USD
  metadata?: object      // platform-specific (e.g. {url, revision, image, machine_type})
  last_updated?: string  // ISO timestamp
}
```

## Billing slot

```ts
billing_periods: BillingPeriod[]

BillingPeriod = { month: string, service: string, cost_usd: number }
```

## Header / sync / selection

```ts
selected_resource_id: string | null
header: { title?: string, subtitle?: string }
sync: { source?: string, syncedAt?: string }
```

`sync.source` values: `gcp` for live GCP data, `mixed`, `seed*`, `daytona` for sandbox tool calls, `ui` for `render_ui`. The canvas auto-switches tabs based on this — set it correctly so the user lands on the right view (the tools handle this for you, but you should know it exists).

## Sandbox state shapes

These get populated only after a `sandbox_*` tool runs.

```ts
sandbox: { id, status, workspace, image, started_at }

terminal_log: TerminalEntry[]
TerminalEntry = { id, command, cwd, stdout, stderr, exit_code, duration_ms, ts }

sandbox_files: { path, bytes, ts, kind }[]

sandbox_preview: { port, url, started_at } | null
// When this is set, the canvas renders an iframe of the URL.
```
