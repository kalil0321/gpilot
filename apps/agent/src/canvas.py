"""Canvas state schema + frontend tool reference (documentation only).

The state shape is defined for real in `gcp_state.py` (the
`GCPCanvasState` TypedDict + `GCPStateMiddleware`). The mirrors below exist
as a quick contract reference for anyone reading the agent code without
having to hop into the middleware module.

Frontend tools (state mutators like `setHeader`, `selectResource`) are
declared on the React side via `useFrontendTool({ name, parameters,
handler })` and are NOT passed to `create_deep_agent(tools=[...])` —
duplicating the declaration there would cause Gemini to reject the request
with "Duplicate function declaration found".
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict
from typing_extensions import NotRequired


class GCPResource(TypedDict, total=False):
    id: str
    type: str  # "project" | "service" | "deployment" | "billing_period"
    name: str
    region: str
    status: str
    cost_usd_mtd: float
    metadata: Dict[str, Any]
    last_updated: str


class BillingPeriod(TypedDict, total=False):
    month: str
    service: str
    cost_usd: float


class CanvasState(TypedDict):
    resources: List[GCPResource]
    billing_periods: List[BillingPeriod]
    selected_resource_id: Optional[str]
    header: NotRequired[Dict[str, str]]
    sync: NotRequired[Dict[str, str]]


# Frontend tools are declared on the React side and forwarded by the
# runtime. This list stays empty intentionally.
frontend_tool_stubs: list = []
