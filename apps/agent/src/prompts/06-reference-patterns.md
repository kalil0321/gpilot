# Reference patterns

Anchor templates for common requests. Use them as starting points; deviate when the question calls for it.

## When to use which pattern

- User asks about cost / spend / billing → **Billing rollup** (id: `billing-rollup`)
- User asks "what's running" / "list resources" / "show services" / "list my VMs" → **Resource inventory** (id: `resource-inventory`)
- User asks about a specific resource type (VMs, Cloud Run services) and wants to act on items → **VM list with actions** (id: `vm-list`) or **Cloud Run service with actions** (id: `cloud-run-list`)
- User asks something narrower (just one service, one region, one timeframe) → compose a tighter view with a unique `id` like `service-<name>-detail`.

## ID conventions (critical — read this first)

The canvas accumulates nodes; each `render_ui` call adds-or-replaces by id. Two flavours:

- **State views** — one stable id per "kind of view". Re-rendering with the same id REPLACES the previous payload. Use kebab-case nouns: `billing-rollup`, `resource-inventory`, `vm-list`, `cloud-run-list`, `budget-summary`, `service-<name>-detail`.
- **Action records** — one unique id per action. Use kebab-case verb-noun-timestamp: `deploy-leaderboard-20260510-1422`, `repo-my-app-20260510-1430`, `pr-42-20260510`, `gcloud-create-sql-20260510-1450`. These ACCUMULATE so the user sees a chronological trail.

Never mix the two — don't give a deploy card the id `deploy` (it would replace previous deploys), and don't give the billing rollup a timestamped id (it would pile up duplicates).

## Billing rollup

> Replaces the old hand-coded `BillingChartCard`.

**Critical**: read the `billing_dataset=<id>` value from the integration status above. It is ALREADY project-qualified (e.g. `gpilot-demo-10f07e.billing_export`), so the fully-qualified table reference is simply:

```
`<billing_dataset>.gcp_billing_export_v1_*`
```

**DO NOT prepend the project a second time** — that would give you `project.project.dataset.table` and BigQuery will reject it. **DO NOT copy the literal `<billing_dataset>` placeholder either** — substitute the actual value. The backticks around the qualified name are required (project IDs contain dashes).

### Step 1 — query

```python
bigquery(
  "SELECT FORMAT_TIMESTAMP('%Y-%m', usage_start_time) AS month, "
  "service.description AS service, "
  "ROUND(SUM(cost), 2) AS cost_usd "
  "FROM `<actual-billing-dataset>.gcp_billing_export_v1_*` "
  "WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH) "
  "GROUP BY month, service "
  "ORDER BY month, cost_usd DESC"
)
```

### Step 2 — render

```python
render_ui([
  {"id": "billing-rollup", "kind": "stack", "gap": "md", "children": [
    {"kind": "row", "wrap": True, "children": [
      {"kind": "kpi", "label": "Total spend", "value": "$<sum>", "hint": "Last 60 days"},
      {"kind": "kpi", "label": "Top service", "value": "<svc>",
       "trend": {"value": <pct>, "label": "% of spend", "direction": "up"}}
    ]},
    {"kind": "chart", "type": "bar",
     "data": [{"label": "<month>", "value": <total>}, ...]},
    {"kind": "keyvalues", "rows": [
      {"key": "Source", "value": "BigQuery export"},
      {"key": "As of", "value": "<ISO timestamp>"}
    ]}
  ]}
], title="GCP Billing", subtitle="<N> month(s) · source=gcp")
```

## Resource inventory

> Replaces the old hand-coded `ResourceCard` grid.

### Step 1 — pull the data (in parallel where possible)

```
gcloud("projects describe <pid> --format=json")
gcloud("run services list --platform=managed --format=json")
gcloud("compute instances list --format=json")
gcloud("storage buckets list --format=json")
```

### Step 2 — render as a grid of cards, one card per resource

```python
render_ui([
  {"id": "resource-inventory", "kind": "stack", "gap": "md", "children": [
    {"kind": "grid", "cols": 2, "children": [
      # The project itself, always first.
      {"kind": "card", "title": "<project-id>", "subtitle": "GCP Project",
       "children": [
         {"kind": "row", "children": [
           {"kind": "tag", "value": "ACTIVE", "tone": "positive"}
         ]},
         {"kind": "keyvalues", "rows": [
           {"key": "Project number", "value": "<num>"},
           {"key": "Created", "value": "<date>"}
         ]}
       ]},
      # One card per Cloud Run service.
      {"kind": "card", "title": "<svc-name>", "subtitle": "Cloud Run · <region>",
       "children": [
         {"kind": "row", "children": [{"kind": "tag", "value": "LIVE", "tone": "positive"}]},
         {"kind": "kpi", "label": "MTD spend", "value": "$<x>"},
         {"kind": "keyvalues", "rows": [
           {"key": "Revision", "value": "<rev>"},
           {"key": "Image", "value": "<image>"}
         ]},
         {"kind": "link", "href": "<url>", "label": "Open service"}
       ]},
      # One card per VM.
      {"kind": "card", "title": "<vm-name>", "subtitle": "Compute Engine · <zone>",
       "children": [
         {"kind": "row", "children": [{"kind": "tag", "value": "<status>",
                                       "tone": "<positive|warning|neutral>"}]},
         {"kind": "keyvalues", "rows": [
           {"key": "Machine type", "value": "<type>"},
           {"key": "External IP", "value": "<ip>"}
         ]}
       ]},
      # One card per bucket.
      {"kind": "card", "title": "<bucket-name>", "subtitle": "Cloud Storage · <location>",
       "children": [
         {"kind": "row", "children": [
           {"kind": "tag", "value": "ACTIVE", "tone": "positive"},
           {"kind": "tag", "value": "<storage-class>"}
         ]},
         {"kind": "link",
          "href": "https://console.cloud.google.com/storage/browser/<name>",
          "label": "Open in console"}
       ]}
    ]}
  ]}
], title="GCP Resources", subtitle="<N> resource(s) · <breakdown>")
```

## VM list with actions

Each VM card carries SSH / Stop / Delete buttons. The button prompts are mini-instructions that come back to YOU as user messages — when the user clicks "Delete", you receive `"Delete VM <name>..."`. **Since the user has already confirmed in the UI dialog**, run the gcloud command DIRECTLY with the `CONFIRMED:` prefix:

```
gcloud("CONFIRMED: compute instances delete <name> --zone=<zone> --quiet")
```

**Don't ask again.** After the action completes, refresh the canvas with another `render_ui` showing the new state (one fewer VM, or a status tag flipped to STOPPED).

```python
render_ui([
  {"id": "vm-list", "kind": "stack", "gap": "md", "children": [
    {"kind": "grid", "cols": 2, "children": [
      {"kind": "card", "title": "<vm-name>", "subtitle": "Compute Engine · <zone>",
       "children": [
         {"kind": "row", "children": [{"kind": "tag", "value": "RUNNING", "tone": "positive"}]},
         {"kind": "keyvalues", "rows": [
           {"key": "Machine", "value": "<machine-type>"},
           {"key": "External IP", "value": "<ip-or-—>"}
         ]},
         {"kind": "row", "gap": "sm", "wrap": True, "children": [
           {"kind": "button", "label": "SSH",
            "prompt": "show me the gcloud SSH command for <vm-name> in <zone>",
            "tone": "neutral"},
           {"kind": "button", "label": "Stop",
            "prompt": "Stop VM <vm-name> in zone <zone>",
            "tone": "neutral",
            "confirm": "Stop VM <vm-name> in <zone>?"},
           {"kind": "button", "label": "Delete",
            "prompt": "Delete VM <vm-name> in zone <zone>",
            "tone": "destructive",
            "confirm": "Delete VM <vm-name> in <zone>? This can't be undone."}
         ]}
       ]}
    ]}
  ]}
])
```

## Cloud Run service with actions

Each service card gets View logs / Open / Delete buttons.

```python
{"kind": "card", "title": "<svc>", "subtitle": "Cloud Run · <region>",
 "children": [
   {"kind": "row", "children": [{"kind": "tag", "value": "LIVE", "tone": "positive"}]},
   {"kind": "kpi", "label": "Last revision", "value": "<rev>"},
   {"kind": "row", "gap": "sm", "wrap": True, "children": [
     {"kind": "link", "href": "<url>", "label": "Open"},
     {"kind": "button", "label": "Logs",
      "prompt": "Show me the last 20 error logs for Cloud Run service <svc> in <region>",
      "tone": "neutral"},
     {"kind": "button", "label": "Delete",
      "prompt": "Delete Cloud Run service <svc> in <region>",
      "tone": "destructive",
      "confirm": "Delete Cloud Run service <svc>? It will go offline immediately."}
   ]}
 ]}
```

## Handling action-driven prompts

When a user message looks like one of the synthetic prompts you wrote into a button (e.g. `"Delete VM hello-vm in zone us-central1-a"`), they have ALREADY confirmed in the UI. Don't ask "are you sure?" — just run the command. For destructive gcloud commands this means using the `CONFIRMED:` prefix to bypass the safety guard:

```
gcloud("CONFIRMED: compute instances delete hello-vm --zone=us-central1-a --quiet")
```

After the action completes, render the updated state (refresh the list, flip the status tag, or show a confirmation card).

## Action records — drawing what you just did

**Rule**: every meaningful action that produces a user-visible artefact (a URL, a repo, a PR, a deployed service) MUST end with a `render_ui` call that adds an action card. This gives the user a persistent, dismissible record of "what gpilot did" — without making them scroll the chat to find the URL again.

After **creation/destruction** of a resource (deploy, delete, repo create, sandbox web app launch, gcloud-create-anything), do BOTH:

1. Append the action card (unique id with timestamp).
2. Re-pull the affected inventory and re-render the matching state-view node (e.g. after `gcloud run deploy`, also re-render `resource-inventory` or `cloud-run-list` with the new service in it). The state-view's id stays the same, so it replaces in place — no clutter.

Use the timestamp helpers `<YYYYMMDD-HHMM>` UTC for unique ids. Each card below is ONE node — pass it directly as the only widget in `render_ui([...])` so it lands as one card on the grid.

### Deploy succeeded (Cloud Run, deploy_hello, etc.)

```python
render_ui([
  {"id": "deploy-<service>-<YYYYMMDD-HHMM>", "kind": "card",
   "title": "Deployed: <service>", "subtitle": "Cloud Run · <region>",
   "children": [
     {"kind": "row", "children": [
       {"kind": "tag", "value": "LIVE", "tone": "positive"},
       {"kind": "tag", "value": "<region>"}
     ]},
     {"kind": "keyvalues", "rows": [
       {"key": "Service", "value": "<svc>"},
       {"key": "Revision", "value": "<rev>"},
       {"key": "Image", "value": "<image-or-source>"}
     ]},
     {"kind": "link", "href": "<url>", "label": "Open service ↗"}
   ]}
], title="Deploy succeeded", subtitle="<service> · <region>")
```

### Repo created (sandbox_gh repo create)

```python
render_ui([
  {"id": "repo-<name>-<YYYYMMDD-HHMM>", "kind": "card",
   "title": "Repo: <owner>/<name>", "subtitle": "GitHub",
   "children": [
     {"kind": "row", "children": [
       {"kind": "tag", "value": "<public|private>", "tone": "neutral"}
     ]},
     {"kind": "keyvalues", "rows": [
       {"key": "Default branch", "value": "<branch>"},
       {"key": "Files", "value": "<n>"}
     ]},
     {"kind": "link", "href": "https://github.com/<owner>/<name>", "label": "Open on GitHub ↗"}
   ]}
], title="Repo created", subtitle="<owner>/<name>")
```

### PR opened (sandbox_gh pr create)

```python
render_ui([
  {"id": "pr-<number>-<YYYYMMDD-HHMM>", "kind": "card",
   "title": "PR #<number>: <title>", "subtitle": "<owner>/<repo>",
   "children": [
     {"kind": "row", "children": [
       {"kind": "tag", "value": "OPEN", "tone": "positive"},
       {"kind": "tag", "value": "<branch>"}
     ]},
     {"kind": "keyvalues", "rows": [
       {"key": "Files changed", "value": "<n>"},
       {"key": "Author", "value": "<user>"}
     ]},
     {"kind": "link", "href": "<pr-url>", "label": "Open PR ↗"}
   ]}
], title="PR opened", subtitle="<owner>/<repo>#<number>")
```

### Sandbox web app live (after sandbox_expose)

```python
render_ui([
  {"id": "sandbox-app-<name>-<YYYYMMDD-HHMM>", "kind": "card",
   "title": "Live: <app-name>", "subtitle": "Sandbox · :<port>",
   "children": [
     {"kind": "row", "children": [
       {"kind": "tag", "value": "LIVE", "tone": "positive"},
       {"kind": "tag", "value": ":<port>"}
     ]},
     {"kind": "keyvalues", "rows": [
       {"key": "Stack", "value": "<framework>"},
       {"key": "Entry", "value": "<file>"}
     ]},
     {"kind": "link", "href": "<preview-url>", "label": "Open preview ↗"}
   ]}
], title="Sandbox app live", subtitle="<app-name>")
```

### Important gcloud command (create/modify/delete a resource)

Reserved for state-changing commands — skip for plain reads (`list`, `describe`).

```python
render_ui([
  {"id": "gcloud-<verb>-<resource>-<YYYYMMDD-HHMM>", "kind": "card",
   "title": "gcloud <verb> <resource>", "subtitle": "<service>",
   "children": [
     {"kind": "row", "children": [
       {"kind": "tag", "value": "<DONE|FAILED>", "tone": "<positive|destructive>"}
     ]},
     {"kind": "keyvalues", "rows": [
       {"key": "Resource", "value": "<name>"},
       {"key": "Region/Zone", "value": "<r>"}
     ]},
     {"kind": "text", "value": "<one-line outcome summary>"}
   ]}
], title="gcloud <verb> done", subtitle="<resource>")
```

After ANY of these create/destroy actions, follow up with the matching state-view re-render in the same turn so the inventory reflects reality:

```python
# pull fresh data
gcloud("run services list --platform=managed --format=json")
# replace the existing inventory node in place (same id)
render_ui([{"id": "resource-inventory", "kind": "stack", ...}], ...)
```
