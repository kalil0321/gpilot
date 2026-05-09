"""Canonical source for GCP billing + resource data.

Resolves at boot to one of three modes based on env:

  source=gcp   gcloud + BigQuery MCPs both wired AND data-flowing
  source=mixed at least one path live, others seeded (e.g. gcloud live,
               BQ MCP wired but the export table doesn't exist yet)
  source=seed  nothing wired

The store exposes `billing_periods_with_source(months)` and
`resources_with_source()` — they return `(rows, source_label)` so the
@tool layer can record the *actual* source per-call rather than the
configured-at-boot label, which would lie when the BQ MCP is set but
the table hasn't populated.
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
    # Returns (rows, label) where label is "gcp" if rows came from live
    # BQ, otherwise "seed" (or a sub-tagged "seed (BQ export pending)").
    def billing_periods_with_source(
        self, months: int
    ) -> tuple[List[Dict[str, Any]], str]: ...
    def resources_with_source(
        self,
    ) -> tuple[List[Dict[str, Any]], str]: ...


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

    def billing_periods_with_source(
        self, months: int
    ) -> tuple[List[Dict[str, Any]], str]:
        return self.billing_periods(months), "seed"

    def resources_with_source(
        self,
    ) -> tuple[List[Dict[str, Any]], str]:
        return self.resources(), "seed"

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
        rows, _ = self.billing_periods_with_source(months)
        return rows

    def billing_periods_with_source(
        self, months: int
    ) -> tuple[List[Dict[str, Any]], str]:
        """Return billing rows + the source label for THIS call.

        Falls through to seed (with a 'seed (BQ export pending)' tag)
        when BIGQUERY_MCP_COMMAND is set but the export table is missing
        or empty — that's the typical state in the first 24h after
        enabling BQ billing export.
        """
        if not gcp_mcp.has_bigquery():
            return self._seed.billing_periods(months), "seed"
        try:
            rows = gcp_integration.fetch_billing(
                months=months, dataset=self._dataset
            )
        except gcp_mcp.NotConfiguredError:
            return self._seed.billing_periods(months), "seed"
        except Exception:  # noqa: BLE001 — BQ raises lots of shapes
            return (
                self._seed.billing_periods(months),
                "seed (BQ export pending)",
            )
        if not rows:
            return (
                self._seed.billing_periods(months),
                "seed (BQ export pending)",
            )
        return rows, "gcp"

    def resources(self) -> List[Dict[str, Any]]:
        rows, _ = self.resources_with_source()
        return rows

    def resources_with_source(
        self,
    ) -> tuple[List[Dict[str, Any]], str]:
        """Return resources + source label for THIS call.

        Live-only: returns the user's actual project info + Cloud Run
        services. We deliberately do NOT pad with seeded BQ datasets /
        GCS buckets anymore — better an honest empty canvas than fake
        cards. Add per-product MCPs (BigQuery datasets list, GCS bucket
        list) here when we want richer real data.

        The two live calls (services list + project describe) are
        independent, so we run them in parallel via threads. That
        roughly halves wall-time vs sequential MCP cold-starts (each
        spawn is ~2.5s — see _run_sync's per-call session model).
        """
        if not gcp_mcp.has_gcloud():
            return [], "seed"

        from concurrent.futures import ThreadPoolExecutor

        def _safe_list(fn, *args, **kwargs) -> List[Dict[str, Any]]:
            try:
                return fn(*args, **kwargs) or []
            except Exception:  # noqa: BLE001 — independent calls; Compute API
                return []      # may not be enabled, etc.

        def _safe_project() -> Optional[Dict[str, Any]]:
            try:
                return gcp_integration.fetch_project_info(self._project_id)
            except Exception:  # noqa: BLE001
                return None

        # Fan out the four independent gcloud calls. The API roundtrips
        # are the long tail (~150-500ms each), so parallelizing roughly
        # cuts wall-time in 4. Failures per-call are absorbed: if the
        # Compute API isn't enabled in the project, that call returns
        # [] without aborting the rest.
        with ThreadPoolExecutor(max_workers=4) as pool:
            f_project = pool.submit(_safe_project)
            f_services = pool.submit(
                _safe_list,
                gcp_integration.fetch_run_services,
                project_id=self._project_id,
            )
            f_vms = pool.submit(
                _safe_list,
                gcp_integration.fetch_compute_instances,
                project_id=self._project_id,
            )
            f_buckets = pool.submit(
                _safe_list,
                gcp_integration.fetch_gcs_buckets,
                project_id=self._project_id,
            )
            project = f_project.result()
            services = f_services.result()
            vms = f_vms.result()
            buckets = f_buckets.result()

        out: List[Dict[str, Any]] = []
        if project:
            out.append(project)
        out.extend(services)
        out.extend(vms)
        out.extend(buckets)
        return out, "gcp"

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
    dataset_env = os.getenv("GCP_BILLING_DATASET", "billing_export").strip()
    # If the user gave a bare dataset id, qualify it with the project.
    if project and "." not in dataset_env:
        dataset = f"{project}.{dataset_env}"
    else:
        dataset = dataset_env
    has_any_live = gcp_mcp.has_bigquery() or gcp_mcp.has_gcloud()

    if project and has_any_live:
        _singleton = GCPStore(project_id=project, dataset=dataset)
    else:
        _singleton = SeedStore()
    return _singleton


def boot_status() -> str:
    """One-line health summary for the agent's boot log + system prompt.

    Format: `source=<label> project=<id> billing_dataset=<id>
            billing_rows=<n> resources=<n> as_of=<iso>`. The agent
    pattern-matches on these k=v pairs to compose BigQuery SQL — in
    particular, `project` + `billing_dataset` are how it builds the
    fully-qualified `<project>.<dataset>.gcp_billing_export_v1_*` table
    reference without having to guess.
    """
    store = get_store()
    label = store.source_label()

    project = os.getenv("GCP_PROJECT_ID", "").strip() or "unset"
    dataset_env = os.getenv("GCP_BILLING_DATASET", "billing_export").strip()
    # Mirror the qualification logic in get_store(): if the user passed
    # a bare dataset name, prepend the project.
    if project != "unset" and "." not in dataset_env:
        dataset_qualified = f"{project}.{dataset_env}"
    else:
        dataset_qualified = dataset_env

    try:
        n_billing = len(store.billing_periods(months=2))
        n_resources = len(store.resources())
    except Exception as e:  # noqa: BLE001 - never block boot
        return (
            f"source={label} project={project} "
            f"billing_dataset={dataset_qualified} error: {e}"
        )

    when = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return (
        f"source={label} project={project} "
        f"billing_dataset={dataset_qualified} "
        f"billing_rows={n_billing} resources={n_resources} as_of={when}"
    )
