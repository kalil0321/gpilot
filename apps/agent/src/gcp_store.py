"""Canonical source for GCP billing + resource data.

Resolves at boot to one of three modes based on env:

  source=gcp   BIGQUERY_MCP_URL + GCLOUD_MCP_URL set → live MCP path
  source=seed  no MCP creds → bundled seed JSON (good demo, offline-OK)
  source=mixed e.g. only BigQuery configured → live billing + seed Cloud Run

The agent doesn't know which mode is active. It calls `get_store()` and
gets back rows in the canonical shape. That keeps the prompt + tool
surface simple and the seed→live cutover invisible.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

from . import gcp_integration, gcp_mcp


_SEED_DIR = Path(__file__).resolve().parent.parent / "data"
_BILLING_SEED = _SEED_DIR / "gcp_billing.seed.json"
_RESOURCES_SEED = _SEED_DIR / "gcp_resources.seed.json"


# --- Protocol -----------------------------------------------------------

class Store(Protocol):
    """Canonical shape every store implementation must satisfy."""

    def billing_periods(self, months: int) -> List[Dict[str, Any]]: ...
    def resources(self) -> List[Dict[str, Any]]: ...
    def source_label(self) -> str: ...
    def is_live(self) -> bool: ...


# --- Seed-only store ----------------------------------------------------

class SeedStore:
    """Backed entirely by `data/gcp_*.seed.json`. No network calls."""

    def billing_periods(self, months: int) -> List[Dict[str, Any]]:
        with _BILLING_SEED.open("r", encoding="utf-8") as f:
            doc = json.load(f)
        rows: List[Dict[str, Any]] = list(doc.get("rows", []))
        # Newest months last in the seed; trim from the right when the
        # caller asks for fewer than the seed contains.
        months_in_seed = sorted({r["month"] for r in rows})
        keep = set(months_in_seed[-months:])
        return [r for r in rows if r["month"] in keep]

    def resources(self) -> List[Dict[str, Any]]:
        with _RESOURCES_SEED.open("r", encoding="utf-8") as f:
            doc = json.load(f)
        return list(doc.get("resources", []))

    def source_label(self) -> str:
        return "seed"

    def is_live(self) -> bool:
        return False


# --- Live (or mixed) store ----------------------------------------------

class GCPStore:
    """Routes each call to its live MCP if configured, else seed.

    Per-method routing means a partially-configured environment (only
    BigQuery wired, gcloud MCP not yet enabled) still gives the user a
    real chart while seed-Cloud-Run cards keep the canvas full.
    """

    def __init__(self, project_id: str, dataset: str) -> None:
        self._project_id = project_id
        self._dataset = dataset
        self._seed = SeedStore()

    def billing_periods(self, months: int) -> List[Dict[str, Any]]:
        if not gcp_mcp.has_bigquery():
            return self._seed.billing_periods(months)
        try:
            rows = gcp_integration.fetch_billing(months=months, dataset=self._dataset)
        except gcp_mcp.NotConfiguredError:
            return self._seed.billing_periods(months)
        return rows or self._seed.billing_periods(months)

    def resources(self) -> List[Dict[str, Any]]:
        if not gcp_mcp.has_gcloud():
            return self._seed.resources()
        try:
            services = gcp_integration.fetch_run_services(project_id=self._project_id)
        except gcp_mcp.NotConfiguredError:
            return self._seed.resources()
        # Live Cloud Run + seeded buckets/datasets — the gcloud MCP only
        # covers compute resources; storage/dataset entries stay seeded
        # until we wire dedicated MCPs for those.
        non_service_seeds = [r for r in self._seed.resources() if r.get("type") != "service"]
        return services + non_service_seeds

    def source_label(self) -> str:
        bq = gcp_mcp.has_bigquery()
        run = gcp_mcp.has_gcloud()
        if bq and run:
            return "gcp"
        if bq or run:
            return "mixed"
        return "seed"

    def is_live(self) -> bool:
        return gcp_mcp.has_bigquery() or gcp_mcp.has_gcloud()


# --- Resolver -----------------------------------------------------------

_singleton: Optional[Store] = None


def get_store() -> Store:
    """Return the active store, creating it on first call.

    Selection rule (cheap to re-check, but cached):
    - GCP_PROJECT_ID set AND any of {BIGQUERY_MCP_URL, GCLOUD_MCP_URL} set
      → GCPStore (which falls back to seed per-call when its MCP is unset)
    - else → SeedStore
    """
    global _singleton
    if _singleton is not None:
        return _singleton

    project = os.getenv("GCP_PROJECT_ID", "").strip()
    dataset = os.getenv("GCP_BILLING_DATASET", "billing_export").strip()
    has_any_mcp = gcp_mcp.has_bigquery() or gcp_mcp.has_gcloud()

    if project and has_any_mcp:
        _singleton = GCPStore(project_id=project, dataset=dataset)
    else:
        _singleton = SeedStore()
    return _singleton


def boot_status() -> str:
    """One-line health summary for the agent's boot log + system prompt.

    Format mirrors the deleted lead_store's: `source=<label> ...`. The
    leading `source=` token is stable so the agent can reason about the
    mode in its prompt.
    """
    store = get_store()
    label = store.source_label()
    try:
        n_billing = len(store.billing_periods(months=2))
        n_resources = len(store.resources())
    except Exception as e:  # noqa: BLE001 - never block boot
        return f"source={label} error: {e}"

    when = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return (
        f"source={label} billing_rows={n_billing} resources={n_resources} as_of={when}"
    )
