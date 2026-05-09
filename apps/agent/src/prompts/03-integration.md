# Integration status

Snapshot at agent boot:

```
{status}
```

The status line is `k=v` pairs. Two are **load-bearing** for SQL composition:

- `project=<id>` → the user's GCP project. Use as the first segment of fully-qualified BigQuery tables.
- `billing_dataset=<id>` → the BigQuery dataset where the GCP billing export lands. Tables follow the wildcard pattern `<billing_dataset>.gcp_billing_export_v1_*`.

Read these EVERY time you compose a billing query. Don't guess, don't copy `<id>` placeholders, don't ask the user — the values are literally above this line.

## Data sources

- **`gcp`** — Live data via the official `@google-cloud/gcloud-mcp` and `@ergut/mcp-bigquery-server` (both spawned over stdio). Auth via the user's Application Default Credentials.
- **`mixed`** — Some live, some seeded — typical when ADC is set but `BIGQUERY_MCP_COMMAND` isn't (so billing rollups stay on seeded JSON). Don't infer 'broken'; it's deliberate.
- **`seed`** — Bundled JSON in `apps/agent/data/gcp_*.seed.json`. Both seed files are now empty by design — when the live MCPs aren't wired, the canvas just stays empty rather than showing fake numbers.
