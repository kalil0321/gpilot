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

        # Aggregate by service across the window. The chart consumes the
        # full per-(month, service) rows; this aggregate just drives the
        # "top services" cards and the human summary.
        totals: Dict[str, float] = defaultdict(float)
        for r in rows:
            totals[r["service"]] += float(r["cost_usd"])
        top_sorted = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        total_cost = sum(totals.values())
        top_service, top_cost = top_sorted[0] if top_sorted else ("—", 0.0)

        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # Cost cards — one per top-5 service. We keep them as
        # type='billing_period' so the frontend can render them with a
        # dedicated card component (vs Cloud Run service cards).
        cost_cards: List[Dict[str, Any]] = []
        for service, cost in top_sorted[:5]:
            cost_cards.append(
                {
                    "id": f"billing:{service}",
                    "type": "billing_period",
                    "name": service,
                    "cost_usd_mtd": round(cost, 2),
                    "metadata": {"window_months": months},
                    "last_updated": now_iso,
                }
            )

        summary = (
            f"Last {months} month(s): ${total_cost:.2f} total. "
            f"Top service: {top_service} (${top_cost:.2f}). "
            f"Source: {source}."
        )

        return Command(
            update={
                "billing_periods": rows,
                "resources": cost_cards,
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

        return Command(
            update={
                "resources": rows,
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
