"""Agent-generated UI tool — `render_ui`.

The whole point of this kit is "agentic interfaces" — UI generated at
runtime by the agent. Most other tools push typed data into typed
slots that the frontend renders with hand-coded components. This tool
inverts that: the agent emits a widget tree (JSON spec) and the
frontend renders whatever it gets via a recursive dispatcher.

The widget vocabulary is intentionally small + opinionated so the
agent doesn't drown in choice and the rendered UI stays clean. See
`prompts.py::WIDGET_SPEC` for the full schema the agent is taught.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, List

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.types import Command


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@tool
def render_ui(
    widgets: Annotated[
        List[dict],
        "List of widget specs to render on the canvas's Render tab. "
        "Each item is {kind: str, ...kindSpecificProps}. Layout widgets "
        "(stack/row/grid/card) carry a `children: Widget[]` array. See "
        "the WIDGET SPEC section of the system prompt for the full vocab "
        "and design rules.",
    ],
    title: Annotated[
        str,
        "Short header above the rendered widgets (1-4 words). Anchors "
        "the user's attention. e.g. 'Spend by region', 'Latency overview'.",
    ] = "",
    subtitle: Annotated[
        str,
        "Optional one-liner under the title. e.g. 'Last 30 days', "
        "'us-central1 only'. Keep it under 60 chars.",
    ] = "",
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Render a custom UI on the canvas's Render tab.

    Use this when the user's question is best answered with a composed
    visualization (KPIs, chart, key/value list, tag breakdown) rather
    than the typed Resources / Sandbox views. The Render tab auto-opens
    when this tool fires.

    Always pair the rendered UI with a ONE-sentence chat caption — the
    canvas is the answer; your reply is the legend, not a recap.
    """
    if not isinstance(widgets, list) or not widgets:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=(
                            "render_ui got an empty widget list — try again "
                            "with at least one widget (e.g. a stack of kpi + "
                            "chart)."
                        ),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    now_iso = _now_iso()
    header_subtitle = subtitle or (
        f"{len(widgets)} widget{'s' if len(widgets) != 1 else ''}"
    )
    summary = title or "Generated view"

    return Command(
        update={
            "dynamic_widgets": widgets,
            "header": {
                "title": title or "Render",
                "subtitle": header_subtitle,
            },
            "sync": {"source": "ui", "syncedAt": now_iso},
            "messages": [
                ToolMessage(
                    content=f"Rendered: {summary}.",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


def load_ui_tools() -> list:
    return [render_ui]
