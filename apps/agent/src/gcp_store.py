"""gcp_store — abstraction over the canonical source for GCP resource +
billing data, mirroring the role `lead_store.py` had for Notion/local JSON.

Phase 1 ships a no-op stub: `boot_status()` returns a placeholder string so
`main.py` can format the integration status without errors. Phase 2 fills
in the real GCP path (BigQuery billing export + Cloud Run list) and the
seeded JSON fallback for offline development.
"""

from __future__ import annotations


def boot_status() -> str:
    """One-line health summary for the agent's boot log + system prompt.

    Phase 1: always returns a placeholder. Phase 2 will probe BigQuery
    + Cloud Run and report `source=gcp` (live), `source=seed` (offline
    dev), or `error: ...`.
    """
    return "source=stub (Phase 1 — GCP integration not yet wired)"
