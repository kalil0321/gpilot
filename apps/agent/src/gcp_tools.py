"""gcp_tools — backend @tool surface for the gpilot agent.

Phase 3 ships two read-only tools that populate the canvas:
- `fetch_billing`   billing rollup → BillingChartCard + per-service cards
- `list_resources`  Cloud Run / BQ / GCS inventory → ServiceCard grid

Both return `Command(update={...})` so the frontend's STATE_SNAPSHOT
picks the change up and the canvas paints in one shot — the LLM doesn't
need to call separate `setHeader`/`setResources` mutators afterward.

Live vs seed routing happens inside `gcp_store`; from the tool's
perspective everything looks the same.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.types import Command


@tool
def fetch_billing(
    months: Annotated[
        int,
        "How many months of billing history to fetch. Default 2.",
    ] = 2,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Fetch GCP billing rollup AND populate the canvas in one shot.

    Reads from the active store (live BigQuery MCP when configured, else
    seeded JSON). Writes three slots on the agent state:
    - `billing_periods`   per-(month, service) cost — drives the chart
    - `resources`         one card per top-spending service
    - `header`            human title/subtitle for the canvas
    - `sync`              source label + timestamp for the audit footer

    The LLM does NOT need to call `setHeader`/`setResources` after this —
    just reply with a 1-sentence caption (the canvas IS the answer).
    """
    try:
        from .gcp_store import get_store

        store = get_store()
        rows, source = store.billing_periods_with_source(months=months)

        if not rows:
            return Command(
                update={
                    "messages": [
                        ToolMessage(
                            content=f"No billing data available (source={source}).",
                            tool_call_id=tool_call_id,
                        )
                    ],
                }
            )

        # Aggregate by service for the human summary only — the chart
        # itself consumes the full per-(month, service) rows.
        totals: Dict[str, float] = defaultdict(float)
        for r in rows:
            totals[r["service"]] += float(r["cost_usd"])
        top_sorted = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        total_cost = sum(totals.values())
        top_service, top_cost = top_sorted[0] if top_sorted else ("—", 0.0)

        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        summary = (
            f"Last {months} month(s): ${total_cost:.2f} total. "
            f"Top service: {top_service} (${top_cost:.2f}). "
            f"Source: {source}."
        )

        # Billing view is billing only: chart + header + sync. We
        # explicitly clear `resources` so a previous list_resources
        # call doesn't leave stale Cloud Run cards alongside the chart
        # — the user complained that mixing the two surfaces is
        # confusing. To see resources, the user re-invokes list_resources.
        return Command(
            update={
                "billing_periods": rows,
                "resources": [],
                "header": {
                    "title": "GCP Billing",
                    "subtitle": summary,
                },
                "sync": {
                    "source": source,
                    "syncedAt": now_iso,
                },
                "messages": [
                    ToolMessage(content=summary, tool_call_id=tool_call_id)
                ],
            }
        )
    except Exception as e:  # noqa: BLE001 - surface error to the LLM
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"fetch_billing error: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )


@tool
def list_resources(
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """List the user's GCP resources (Cloud Run services, datasets, buckets).

    Reads from the active store (live gcloud MCP when configured, else
    seeded JSON). Writes `resources`, `header`, and `sync` to state.
    """
    try:
        from .gcp_store import get_store

        store = get_store()
        rows, source = store.resources_with_source()

        if not rows:
            return Command(
                update={
                    "messages": [
                        ToolMessage(
                            content=f"No resources to show (source={source}).",
                            tool_call_id=tool_call_id,
                        )
                    ],
                }
            )

        services = sum(1 for r in rows if r.get("type") == "service")
        total_mtd = sum(float(r.get("cost_usd_mtd") or 0.0) for r in rows)
        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        summary = (
            f"{len(rows)} resources ({services} Cloud Run services). "
            f"Combined MTD spend: ${total_mtd:.2f}. "
            f"Source: {source}."
        )

        # Resources view is resources only: clear billing_periods so a
        # previous fetch_billing call doesn't leave a stale chart above
        # the resource grid (mirror of fetch_billing's clear-resources
        # behaviour — each tool gives one view).
        return Command(
            update={
                "resources": rows,
                "billing_periods": [],
                "header": {
                    "title": "GCP Resources",
                    "subtitle": summary,
                },
                "sync": {
                    "source": source,
                    "syncedAt": now_iso,
                },
                "messages": [
                    ToolMessage(content=summary, tool_call_id=tool_call_id)
                ],
            }
        )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"list_resources error: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )


def load_gcp_tools() -> list:
    """Return the list of backend tools to bind to the deep agent.

    Frontend tools (state mutators like `selectResource`) are declared
    React-side via `useFrontendTool` and forwarded by the runtime — they
    don't appear here.
    """
    return [fetch_billing, list_resources]
