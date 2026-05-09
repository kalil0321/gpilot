"""GCPStateMiddleware — declares the gpilot canvas fields on the agent's
TypedDict state schema so they survive STATE_SNAPSHOT round-trips.

State shape mirrors the React `AgentState` shape in
`apps/frontend/src/lib/gpilot/types.ts` (see Phase 1+ scaffolding).

Phase-1 hydration: the `before_agent` hook is intentionally a no-op for now.
Phase 2 will populate `resources` + `billing_periods` from `gcp_store` when
the user lands on a fresh thread.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from typing_extensions import NotRequired, TypedDict


class _Header(TypedDict, total=False):
    title: str
    subtitle: str


class _SyncMeta(TypedDict, total=False):
    source: str
    syncedAt: Optional[str]


class _GCPResource(TypedDict, total=False):
    id: str
    type: str  # "project" | "service" | "deployment" | "billing_period" | "dataset" | "bucket"
    name: str
    region: str
    status: str
    cost_usd_mtd: float
    metadata: dict[str, Any]
    last_updated: str


class _BillingPeriod(TypedDict, total=False):
    month: str  # ISO "2026-04"
    service: str  # "Cloud Run", "BigQuery", ...
    cost_usd: float


def _replace(_left: Any, right: Any) -> Any:
    """Reducer: always take the most recent value (last-write-wins)."""
    return right


class GCPCanvasState(AgentState):
    """Extended agent state for the gpilot canvas.

    Each field is `NotRequired` so the agent can boot without all fields
    set; the frontend's merge layer provides defaults on the React side.
    """

    resources: NotRequired[Annotated[list[_GCPResource], _replace]]
    billing_periods: NotRequired[Annotated[list[_BillingPeriod], _replace]]
    selected_resource_id: NotRequired[Annotated[Optional[str], _replace]]
    header: NotRequired[Annotated[_Header, _replace]]
    sync: NotRequired[Annotated[_SyncMeta, _replace]]


class GCPStateMiddleware(AgentMiddleware[GCPCanvasState, Any]):  # type: ignore[type-arg]
    """Contributes the gpilot canvas state schema to the graph.

    Phase 1: schema-only; no hydration. Phase 2 adds a `before_agent` hook
    that pre-populates `billing_periods` + `resources` on a fresh thread
    from `gcp_store.get_store().snapshot()`.
    """

    state_schema = GCPCanvasState

    def before_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None
