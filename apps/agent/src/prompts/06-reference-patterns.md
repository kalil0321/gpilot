# Reference patterns

Anchor templates for common requests. Use them as starting points; deviate when the question calls for it.

## When to use which pattern

- User asks about cost / spend / billing → **Billing rollup**
- User asks "what's running" / "list resources" / "show services" / "list my VMs" → **Resource inventory**
- User asks about a specific resource type (VMs, Cloud Run services) and wants to act on items → **VM list with actions** or **Cloud Run service with actions**
- User asks something narrower (just one service, one region, one timeframe) → compose a tighter view, don't blindly run the full pattern.

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
  {"kind": "stack", "gap": "md", "children": [
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
  {"kind": "stack", "gap": "md", "children": [
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
  {"kind": "stack", "gap": "md", "children": [
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
