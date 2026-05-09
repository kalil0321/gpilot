"""Typed wrappers + response normalization on top of `gcp_mcp.py`.

The official gcloud-mcp exposes a single `run_gcloud_command` tool — we
build typed callers (fetch_billing, fetch_run_services, ...) on top of
it by composing CLI invocations and parsing JSON output.

Canonical canvas shapes:

- BillingPeriod = {"month", "service", "cost_usd"}
- GCPResource   = {"id", "type", "name", "region"?, "status"?,
                   "cost_usd_mtd"?, "metadata"?, "last_updated"?}

When a path raises `NotConfiguredError` (e.g. ADC unset, or BigQuery
MCP unset), the caller in `gcp_store` falls through to seeded JSON.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import gcp_mcp


# --- Billing (BigQuery MCP) ---------------------------------------------

# Canonical query against `gcp_billing_export_v1_*`. The standard daily
# detailed export has `usage_start_time`, `service.description`, `cost`.
# We collapse to month + service + cost — sufficient for the chart.
_BILLING_SQL = """
SELECT
  FORMAT_TIMESTAMP('%Y-%m', usage_start_time) AS month,
  service.description AS service,
  ROUND(SUM(cost), 2) AS cost_usd
FROM `{dataset}.gcp_billing_export_v1_*`
WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL {months} MONTH)
GROUP BY month, service
ORDER BY month, cost_usd DESC
""".strip()


def fetch_billing(months: int, dataset: str) -> List[Dict[str, Any]]:
    """Run the canonical billing query via the BigQuery MCP, normalize.

    Args:
        months: Window size in months (e.g. 2 → last two months).
        dataset: Fully-qualified dataset id, e.g. "<project>.billing_export".

    Returns: list[BillingPeriod]. Empty list when the MCP returns no rows.
    Raises NotConfiguredError when BIGQUERY_MCP_COMMAND is unset.
    """
    sql = _BILLING_SQL.format(dataset=dataset, months=months)
    raw = gcp_mcp.bq_query(sql)
    rows = _extract_rows(raw)

    out: List[Dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict) and {"month", "service", "cost_usd"} <= row.keys():
            out.append(
                {
                    "month": str(row["month"]),
                    "service": str(row["service"]),
                    "cost_usd": float(row["cost_usd"]),
                }
            )
        elif isinstance(row, dict) and "f" in row:
            # Google's typed shape: row["f"] = [{"v": ...}, ...]
            fields = [f.get("v") for f in row["f"]]
            if len(fields) >= 3:
                out.append(
                    {
                        "month": str(fields[0]),
                        "service": str(fields[1]),
                        "cost_usd": float(fields[2]),
                    }
                )
    return out


def _extract_rows(raw: Any) -> List[Dict[str, Any]]:
    """BigQuery MCPs vary in their response wrapping. Try the common ones."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("rows", "results", "data"):
            v = raw.get(key)
            if isinstance(v, list):
                return v
    return []


# --- Cloud Run (gcloud MCP) ---------------------------------------------

def fetch_run_services(project_id: str) -> List[Dict[str, Any]]:
    """List Cloud Run services across all regions, normalize to GCPResource.

    Composed via the gcloud MCP's `run_gcloud_command`. We pass
    `--platform=managed --format=json` and rely on gcloud's JSON output
    being self-describing.
    """
    raw = gcp_mcp.gcloud_run(
        f"run services list --platform=managed --format=json --project={project_id}"
    )
    services = raw if isinstance(raw, list) else []

    out: List[Dict[str, Any]] = []
    for svc in services:
        # gcloud's services-list response shape:
        # { "metadata": {"name", "namespace", "labels", "annotations", ...},
        #   "spec": {...},
        #   "status": {"url", "latestReadyRevisionName", "conditions"[...]},
        # }
        meta = svc.get("metadata") or {}
        status = svc.get("status") or {}
        name = meta.get("name") or ""
        if not name:
            continue
        # Region lives in metadata.labels.cloud.googleapis.com/location
        labels = meta.get("labels") or {}
        region = (
            labels.get("cloud.googleapis.com/location")
            or meta.get("namespace")
            or "unknown"
        )
        # Healthy = top-of-conditions has type=Ready, status=True
        conditions = status.get("conditions") or []
        ready = next((c for c in conditions if c.get("type") == "Ready"), None)
        is_live = bool(ready and ready.get("status") == "True")

        # Latest image — pluck from spec.template.spec.containers[0].image
        spec = (svc.get("spec") or {}).get("template", {}).get("spec", {})
        containers = spec.get("containers") or []
        image = containers[0].get("image") if containers else None

        out.append(
            {
                "id": f"service:{region}/{name}",
                "type": "service",
                "name": name,
                "region": region,
                "status": "live" if is_live else "degraded",
                "cost_usd_mtd": 0.0,  # gcloud doesn't surface this; left to billing rollup
                "metadata": {
                    "platform": "Cloud Run",
                    "url": status.get("url"),
                    "revision": status.get("latestReadyRevisionName"),
                    "image": image,
                },
                "last_updated": meta.get("creationTimestamp"),
            }
        )
    return out


# --- Project + utility wrappers -----------------------------------------

def fetch_project_info(project_id: str) -> Optional[Dict[str, Any]]:
    """Return project metadata as a GCPResource of type 'project', or None."""
    try:
        raw = gcp_mcp.gcloud_run(
            f"projects describe {project_id} --format=json"
        )
    except gcp_mcp.NotConfiguredError:
        return None
    if not isinstance(raw, dict):
        return None

    return {
        "id": f"project:{project_id}",
        "type": "project",
        "name": raw.get("name") or project_id,
        "status": raw.get("lifecycleState", "ACTIVE").lower(),
        "metadata": {
            "platform": "GCP Project",
            "project_number": raw.get("projectNumber"),
            "create_time": raw.get("createTime"),
        },
        "last_updated": raw.get("createTime"),
    }
