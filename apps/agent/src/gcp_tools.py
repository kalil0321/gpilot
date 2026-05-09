"""gcp_tools — backend @tool surface for the gpilot agent.

Tool families:

- Canvas-updating (typed):
  - `fetch_billing`   billing rollup → BillingChartCard + per-service cards
  - `list_resources`  Cloud Run + Compute + GCS inventory → Resource grid

- Generic agent capabilities (NEW — answer in chat, no canvas write):
  - `gcloud`          run any gcloud CLI invocation
  - `bigquery`        run any BigQuery SQL

- Action shortcut:
  - `deploy_hello`    spin up Google's hello-world container on Cloud Run

Canvas-updating tools return `Command(update={...})` so the frontend's
STATE_SNAPSHOT picks the change up and the canvas paints in one shot.
Generic tools just append a ToolMessage with the result text — the
agent reasons over it and replies in chat.
"""

from __future__ import annotations

import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.types import Command

from . import gcp_mcp


# Generic-tool result text gets truncated before reaching the LLM. Full
# command output can run to tens of KB (e.g. `gcloud compute instances
# list` on a busy project) — that bloats the context window for no
# reason, since the agent only needs the gist + a few key fields. The
# raw payload still lives in the tool result; we just trim what's sent
# back to the chat thread.
_MAX_TOOL_OUTPUT_CHARS = 12_000


def _truncate(text: str, limit: int = _MAX_TOOL_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-(limit // 2) :]
    omitted = len(text) - len(head) - len(tail)
    return f"{head}\n\n... [{omitted} chars omitted] ...\n\n{tail}"


# ---------------------------------------------------------------------------
# Typed canvas-updating tools
# ---------------------------------------------------------------------------


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
    - `resources`         (cleared — billing view doesn't show cards)
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
    except Exception as e:  # noqa: BLE001
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
    """List the user's GCP resources and put them on the canvas.

    Pulls in parallel from the gcloud MCP:
    - project info
    - Cloud Run services
    - Compute Engine VMs
    - Cloud Storage buckets

    Each slot fails independently — if the Compute API isn't enabled
    on the project, the VM call returns [] but Cloud Run + buckets
    still surface. Writes `resources`, `header`, and `sync` to state.
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
                            content=(
                                f"No resources to show (source={source}). "
                                "The project exists but has no Cloud Run "
                                "services, VMs, or GCS buckets yet."
                            ),
                            tool_call_id=tool_call_id,
                        )
                    ],
                }
            )

        services = sum(1 for r in rows if r.get("metadata", {}).get("platform") == "Cloud Run")
        vms = sum(1 for r in rows if r.get("metadata", {}).get("platform") == "Compute Engine")
        buckets = sum(1 for r in rows if r.get("metadata", {}).get("platform") == "Cloud Storage")
        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        breakdown_parts: List[str] = []
        if services:
            breakdown_parts.append(f"{services} Cloud Run")
        if vms:
            breakdown_parts.append(f"{vms} VM{'s' if vms != 1 else ''}")
        if buckets:
            breakdown_parts.append(f"{buckets} bucket{'s' if buckets != 1 else ''}")
        breakdown = ", ".join(breakdown_parts) if breakdown_parts else "project info only"

        summary = (
            f"{len(rows)} resources ({breakdown}). Source: {source}."
        )

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


# ---------------------------------------------------------------------------
# Generic agent capabilities — give the agent a real toolbox
# ---------------------------------------------------------------------------


# Block obviously-destructive gcloud verbs unless the user explicitly
# asked. The agent will be told in the prompt that destructive verbs
# require confirmation; this guard is a belt-and-suspenders against the
# agent inventing a `delete` call on its own (the LLM has been known to
# confidently run `gcloud projects delete` to "clean up").
_DESTRUCTIVE_VERBS = re.compile(
    r"\b(delete|remove-iam-policy-binding|destroy|kill|abandon|purge)\b",
    re.IGNORECASE,
)


@tool
def gcloud(
    command: Annotated[
        str,
        "Full gcloud CLI invocation MINUS the leading 'gcloud'. "
        "ALWAYS append --format=json when reading data so the result "
        "parses cleanly. Examples:\n"
        "  - 'compute instances list --format=json'\n"
        "  - 'run services list --region=us-central1 --format=json'\n"
        "  - 'storage buckets list --format=json'\n"
        "  - 'iam service-accounts list --format=json'\n"
        "  - 'projects describe my-project --format=json'\n"
        "  - 'services list --enabled --format=json'\n"
        "Do NOT include the project flag — it's auto-appended from "
        "GCP_PROJECT_ID when not present.",
    ],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Run any gcloud command. Powers most read-only inspection.

    Use this for anything not covered by the typed tools (VMs, IAM,
    services-enabled list, project policies, network, etc.). For
    canvas-targeted views, prefer `list_resources` or `fetch_billing`
    — those put cards on the screen.

    Returns the parsed JSON or raw text as a tool message. Output is
    truncated past ~12k chars to keep the context window sane.
    """
    cmd = command.strip()
    if not cmd:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content="gcloud error: empty command.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    if _DESTRUCTIVE_VERBS.search(cmd):
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=(
                            "Destructive gcloud command blocked at the tool "
                            "layer. If the user explicitly asked for this, "
                            "ask them to confirm in chat first; once "
                            "confirmed, prefix the command with "
                            "'CONFIRMED: ' to run it."
                        ),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    if cmd.startswith("CONFIRMED:"):
        cmd = cmd[len("CONFIRMED:") :].strip()

    # Auto-append --project if missing AND project env is set. Saves the
    # agent from forgetting it on every call.
    project_id = os.getenv("GCP_PROJECT_ID", "").strip()
    if project_id and "--project" not in cmd:
        cmd = f"{cmd} --project={project_id}"

    started = time.time()
    try:
        raw = gcp_mcp.gcloud_run(cmd)
    except gcp_mcp.NotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"gcloud not configured: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"gcloud {cmd!r} failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    elapsed_ms = int((time.time() - started) * 1000)

    # Stringify whatever shape the MCP returned. JSON for structured,
    # raw for plain stdout.
    if isinstance(raw, (dict, list)):
        import json as _json

        body = _json.dumps(raw, indent=2, default=str)
    else:
        body = str(raw)

    body = _truncate(body)
    summary = f"Ran `gcloud {cmd}` in {elapsed_ms}ms."
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=f"{summary}\n\n```\n{body}\n```",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


@tool
def bigquery(
    sql: Annotated[
        str,
        "BigQuery Standard SQL query. ALWAYS LIMIT to <=200 rows for "
        "ad-hoc queries on large tables. Use the project's billing "
        "export tables when the user asks about costs/spend.",
    ],
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Run any BigQuery SQL query via the BigQuery MCP.

    For routine billing rollups, prefer `fetch_billing` — it puts the
    chart on the canvas. Use this tool for ad-hoc questions: 'show
    yesterday's top 5 SKUs', 'spend by region last month', etc.
    """
    sql_clean = sql.strip()
    if not sql_clean:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content="bigquery error: empty SQL.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    started = time.time()
    try:
        raw = gcp_mcp.bq_query(sql_clean)
    except gcp_mcp.NotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"BigQuery MCP not configured: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"BigQuery query failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    elapsed_ms = int((time.time() - started) * 1000)

    import json as _json

    body = (
        _json.dumps(raw, indent=2, default=str)
        if isinstance(raw, (dict, list))
        else str(raw)
    )
    body = _truncate(body)
    summary = f"Ran BigQuery query in {elapsed_ms}ms."
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=f"{summary}\n\n```\n{body}\n```",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


# ---------------------------------------------------------------------------
# Action shortcuts
# ---------------------------------------------------------------------------


@tool
def deploy_hello(
    name: Annotated[
        str,
        "Service name (lowercase, hyphenated). Default 'hello-gpilot'.",
    ] = "hello-gpilot",
    region: Annotated[str, "Cloud Run region. Default 'us-central1'."] = "us-central1",
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Spin up Google's public hello-world container on Cloud Run.

    Uses the official `us-docker.pkg.dev/cloudrun/container/hello`
    image — no Daytona sandbox / Cloud Build / source-deploy needed.
    Once it's live, the URL responds with a basic HTML page.

    Best for: 'spin up a server for me', 'deploy something I can curl'.
    Costs ~$0 because Cloud Run min-instances=0 (idle deploy is free).
    """
    project_id = os.getenv("GCP_PROJECT_ID", "").strip()
    if not project_id:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content="GCP_PROJECT_ID isn't set in the agent env.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    image = "us-docker.pkg.dev/cloudrun/container/hello"
    cmd = (
        f"run deploy {name} --image={image} --region={region} "
        f"--platform=managed --allow-unauthenticated --quiet --format=json "
        f"--project={project_id}"
    )

    started = time.time()
    try:
        raw = gcp_mcp.gcloud_run(cmd)
    except gcp_mcp.NotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"gcloud not configured: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"deploy_hello failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )
    elapsed_ms = int((time.time() - started) * 1000)

    url = None
    if isinstance(raw, dict):
        url = (raw.get("status") or {}).get("url")

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    summary = (
        f"Deployed {name} to Cloud Run ({region}) in {elapsed_ms // 1000}s."
        + (f" URL: {url}" if url else "")
    )
    return Command(
        update={
            "header": {
                "title": "Cloud Run Deployment",
                "subtitle": summary,
            },
            "sync": {
                "source": "gcp",
                "syncedAt": now_iso,
            },
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


def load_gcp_tools() -> list:
    """Return the list of backend tools to bind to the deep agent.

    Frontend tools (state mutators like `selectResource`) are declared
    React-side via `useFrontendTool` and forwarded by the runtime — they
    don't appear here.

    Sandbox tools merge in lazily so the agent boots even if
    daytona-sdk hasn't been installed yet (`uv sync` after the
    pyproject change).
    """
    # `fetch_billing` and `list_resources` were typed canvas-update
    # tools that pushed structured rows into hardcoded React components
    # (BillingChartCard, ResourceCard). They've been retired in favour
    # of the agent calling `gcloud` / `bigquery` for raw data and then
    # composing the right view itself with `render_ui`. The functions
    # are kept in this module for easy revert; just re-add them to the
    # list below if the agent's generated UI under-delivers and we want
    # a typed fallback.
    tools: list = [
        # Generic data access
        gcloud,
        bigquery,
        # Action shortcuts
        deploy_hello,
    ]

    # Generated UI — the marquee tool that lets the agent compose
    # bespoke views from a widget vocabulary at runtime.
    try:
        from .ui_tools import load_ui_tools

        tools.extend(load_ui_tools())
    except ImportError as e:
        print(f"[gcp_tools] render_ui tool disabled: {e}", flush=True)

    try:
        from .sandbox_tools import load_sandbox_tools

        tools.extend(load_sandbox_tools())
    except ImportError as e:
        # daytona-sdk not installed yet, or InjectedState moved across
        # langgraph versions — agent still boots, just without sandbox.
        print(
            f"[gcp_tools] Sandbox tools disabled: {e}. "
            "Run `cd apps/agent && uv sync` to install daytona-sdk.",
            flush=True,
        )

    return tools
