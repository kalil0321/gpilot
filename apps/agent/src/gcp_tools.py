"""gcp_tools — backend @tool surface for the gpilot agent.

Phase 1: empty list. Phase 2 will register tools that wrap the GCP MCP
clients in `gcp_mcp.py` (`fetch_billing`, `list_services`, …) and the
Daytona sandbox helpers in `sandbox_tools.py` (Phase 4).

Backend tools mutate canvas state via `Command(update={...})` so the
frontend's STATE_SNAPSHOT picks the change up automatically. Frontend
tools (small UI mutators like `setHeader`, `selectResource`) are declared
React-side via `useFrontendTool` — they don't appear here.
"""

from __future__ import annotations


def load_gcp_tools() -> list:
    """Return the list of backend tools to bind to the deep agent.

    Phase 1: returns an empty list — the agent boots without any backend
    tools and can only respond conversationally. Phase 2 populates this.
    """
    return []
