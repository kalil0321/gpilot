"""Typed wrappers + response normalization on top of `gcp_mcp.py`.

`gcp_mcp` returns whatever shape the MCP server emits (structured content
or parsed JSON text blocks). This layer normalizes those into the
canonical canvas shapes the agent + frontend expect:

- BillingPeriod = {"month", "service", "cost_usd"}
- GCPResource   = {"id", "type", "name", "region"?, "status"?,
                   "cost_usd_mtd"?, "metadata"?, "last_updated"?}

When the MCP path raises `NotConfiguredError`, callers handle the
fallback to seeded JSON via `gcp_store`. This module purposefully does
NOT decide between live vs seed — that's `gcp_store`'s job.
"""

from __future__ import annotations

from typing import Any, Dict, List

from . import gcp_mcp


# --- Billing ------------------------------------------------------------

# Generated against `gcp_billing_export_v1` schema. The standard daily
# detailed export has `usage_start_time`, `service.description`, `cost`.
# Our canonical shape collapses to month + service + cost — sufficient
# for the chart and small enough to keep state snappy.
_BILLING_SQL = """
SELECT
  FORMAT_TIMESTAMP('%Y-%m', usage_start_time) AS month,
  service.description AS service,
  ROUND(SUM(cost), 2) AS cost_usd
FROM `{dataset}.gcp_billing_export_v1_*`
WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {months} MONTH)
GROUP BY month, service
ORDER BY month, cost_usd DESC
""".strip()


def fetch_billing(months: int, dataset: str) -> List[Dict[str, Any]]:
    """Run the canonical billing query and normalize rows.

    Args:
        months: Window size in months (e.g. 2 → last two months).
        dataset: Fully-qualified dataset id, e.g. "<project>.billing_export".

    Returns: list[BillingPeriod]. Empty list if MCP returns no rows.
    Raises NotConfiguredError when BIGQUERY_MCP_URL is unset.
    """
    sql = _BILLING_SQL.format(dataset=dataset, months=months)
    raw = gcp_mcp.bq_query(sql)
    rows = raw.get("rows") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        # The MCP may return rows as plain dicts or as Google's "f/v"
        # field-array shape — handle both.
        if isinstance(row, dict) and {"month", "service", "cost_usd"} <= row.keys():
            out.append({
                "month": str(row["month"]),
                "service": str(row["service"]),
                "cost_usd": float(row["cost_usd"]),
            })
        elif isinstance(row, dict) and "f" in row:
            # Google's typed response: row["f"] = [{"v": ...}, ...]
            fields = [f.get("v") for f in row["f"]]
            if len(fields) >= 3:
                out.append({
                    "month": str(fields[0]),
                    "service": str(fields[1]),
                    "cost_usd": float(fields[2]),
                })
    return out


# --- Resources (Cloud Run, BigQuery datasets, GCS buckets) --------------

def fetch_run_services(project_id: str) -> List[Dict[str, Any]]:
    """Normalize the gcloud MCP's `run.services.list` response.

    Each service is mapped to a canonical GCPResource dict so it slots
    straight into `state.resources` without further massaging.
    """
    raw = gcp_mcp.run_list(project_id=project_id)
    services = raw.get("services") or raw.get("items") or []
    out: List[Dict[str, Any]] = []
    for svc in services:
        name = svc.get("name") or svc.get("metadata", {}).get("name", "")
        region = svc.get("region") or svc.get("metadata", {}).get("region", "")
        if not name:
            continue
        out.append({
            "id": f"service:{region or 'global'}/{name}",
            "type": "service",
            "name": name,
            "region": region,
            "status": svc.get("status") or "live",
            "cost_usd_mtd": float(svc.get("cost_usd_mtd") or 0.0),
            "metadata": {
                "platform": "Cloud Run",
                "url": svc.get("url") or svc.get("status_url"),
                "revision": svc.get("latest_revision"),
                "image": svc.get("image"),
            },
            "last_updated": svc.get("last_modified") or svc.get("update_time"),
        })
    return out
