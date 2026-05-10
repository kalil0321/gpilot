"""Agent-generated UI tool — `render_ui`.

The whole point of this kit is "agentic interfaces" — UI generated at
runtime by the agent. Most other tools push typed data into typed
slots that the frontend renders with hand-coded components. This tool
inverts that: the agent emits a widget tree (JSON spec) and the
frontend renders whatever it gets via a recursive dispatcher.

The canvas is a board of "nodes" that accumulate over time. Each
top-level widget passed to `render_ui` is one node, identified by its
`id`:
  - When the id matches an existing node, the new payload REPLACES
    it in place (state-view pattern: `billing-rollup`,
    `resource-inventory` re-render naturally on each refresh).
  - When the id is new (or absent), the node is APPENDED (action
    pattern: `deploy-<svc>-<ts>`, `repo-<name>`, `pr-<number>` build
    up a chronological record of what the agent did).

The widget vocabulary is intentionally small + opinionated so the
agent doesn't drown in choice and the rendered UI stays clean. See
`prompts/05-widget-spec.md` for the full schema the agent is taught.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, List

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.types import Command


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_node_ids(widgets: List[dict]) -> List[dict]:
    """Auto-fill missing top-level `id`s with a uuid hex prefix.

    Only top-level widgets become canvas nodes; nested children
    (inside `card`/`stack`/`row`/`grid`) don't need ids. We mutate a
    shallow copy so the agent's original list isn't touched.
    """
    out: List[dict] = []
    for w in widgets:
        if not isinstance(w, dict):
            out.append(w)
            continue
        if isinstance(w.get("id"), str) and w["id"].strip():
            out.append(w)
            continue
        out.append({**w, "id": f"node-{uuid.uuid4().hex[:10]}"})
    return out


def _inject_node_header(
    widgets: List[dict], title: str, subtitle: str
) -> List[dict]:
    """Promote the function-level title/subtitle onto the first
    top-level widget if it doesn't already carry them.

    The frontend's NodeShell renders these as the node's header label
    so the user always knows what each card represents. Older agent
    prompts pass title/subtitle as render_ui kwargs; this preserves
    that flow while letting newer prompts set per-widget headers
    directly.
    """
    if not (title or subtitle):
        return widgets
    out: List[dict] = []
    injected = False
    for w in widgets:
        if not isinstance(w, dict) or injected:
            out.append(w)
            continue
        patch: dict[str, Any] = {}
        if title and not (isinstance(w.get("title"), str) and w["title"].strip()):
            patch["title"] = title
        if (
            subtitle
            and not (isinstance(w.get("subtitle"), str) and w["subtitle"].strip())
        ):
            patch["subtitle"] = subtitle
        out.append({**w, **patch} if patch else w)
        injected = True  # only inject into the first top-level widget
    return out


@tool
def render_ui(
    widgets: Annotated[
        List[dict],
        "List of top-level widget specs — each becomes a separate node "
        "on the canvas grid. Each item is {id?: str, kind: str, "
        "...kindSpecificProps}. Layout widgets (stack/row/grid/card) "
        "carry a `children: Widget[]` array. The `id` controls "
        "lifecycle: matching id REPLACES the existing node "
        "(state-view, e.g. 'billing-rollup'), new id APPENDS "
        "(action node, e.g. 'deploy-leaderboard-2026-05-10'). Missing "
        "id auto-fills as a uuid (always appends — pick a semantic id "
        "if you might re-render). See WIDGET SPEC + REFERENCE PATTERNS "
        "in the system prompt.",
    ],
    title: Annotated[
        str,
        "Short header (1-4 words) for THIS render. Auto-injected onto "
        "the first top-level widget as its node label so the user "
        "sees what the card represents. Prefer setting `title` "
        "directly on each top-level widget when rendering multiple "
        "nodes at once. e.g. 'Spend by region', 'Deploy succeeded'.",
    ] = "",
    subtitle: Annotated[
        str,
        "Optional one-liner under the title (also auto-injected onto "
        "the first widget). e.g. 'Last 30 days', 'us-central1 only'. "
        "Keep it under 60 chars.",
    ] = "",
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Render or update one-or-more nodes on the canvas board.

    The canvas accumulates nodes; the user can dismiss any node with
    its × button. Use this for both:
      - State views (billing rollup, resource inventory): pick a
        semantic id like `billing-rollup` so a refresh REPLACES the
        existing node instead of duplicating it.
      - Action results (deploy succeeded, repo created, PR opened):
        pick a unique id like `deploy-leaderboard-2026-05-10T14-22Z`
        so the action gets its own card and persists alongside others.

    Always pair the render with a ONE-sentence chat caption — the
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

    nodes = _ensure_node_ids(_inject_node_header(widgets, title, subtitle))
    now_iso = _now_iso()
    header_subtitle = subtitle or (
        f"{len(nodes)} node{'s' if len(nodes) != 1 else ''}"
    )
    summary = title or "Generated view"

    return Command(
        update={
            "dynamic_widgets": nodes,
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
