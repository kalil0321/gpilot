"""mcp-use HTTP client wrappers for the GCP / Cloudflare MCP servers.

Phase 2 ships the plumbing: client factory + per-call helpers + the
async-from-sync trampoline cribbed verbatim from the deleted notion_mcp.py
(it works around `langgraph dev`'s sync-on-async tool execution path).

Phase 3+ wires actual tool calls (`bq_query`, `run_list`, `cf_dns_create`).
For now, all helpers raise NotConfiguredError when their endpoint env var
is unset, and `gcp_store` falls back to seeded JSON in that case.

ENDPOINT CONFIG via env (all optional; unset → seed-only mode):
- BIGQUERY_MCP_URL    Google's hosted BigQuery MCP endpoint
- GCLOUD_MCP_URL      gcloud / Cloud Run MCP endpoint
- CLOUDFLARE_MCP_URL  Cloudflare community MCP endpoint
- *_MCP_BEARER_TOKEN  per-server, sent as `Authorization: Bearer <token>`
                      (Google MCPs use ADC / SA — for now we wire the
                      bearer hook even though we may swap to OIDC later)

The exact URLs and auth shape for Google's hosted MCPs are still
moving (March 2026 announcement). Treat the env names as the contract;
the code below is correct against mcp-use 1.7.x's HTTP connector regardless.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()


class NotConfiguredError(RuntimeError):
    """Raised when a hosted MCP endpoint is queried but its URL is unset.

    Caught by `gcp_store` and `gcp_integration` so the fallback path to
    seeded JSON kicks in cleanly instead of bubbling up as a 500.
    """


# --- mcp-use config builders --------------------------------------------

def _http_server_config(url: str, bearer: Optional[str]) -> Dict[str, Any]:
    """Build the inner-server dict shape mcp-use's `from_dict` expects.

    `"url"` selects the HTTP connector (verified against mcp-use 1.7.x —
    `mcp_use/client/config.py` keys off the presence of `"url"` to pick
    HttpConnector vs StdioConnector).
    """
    cfg: Dict[str, Any] = {"url": url, "timeout": 15}
    if bearer:
        cfg["headers"] = {"Authorization": f"Bearer {bearer}"}
    return cfg


def _client_config(server_id: str, env_url_key: str, env_bearer_key: str) -> Dict[str, Any]:
    url = os.getenv(env_url_key, "").strip()
    if not url:
        raise NotConfiguredError(
            f"{env_url_key} is unset. Set it to your hosted MCP endpoint, "
            f"or rely on the seeded fallback in gcp_store."
        )
    bearer = os.getenv(env_bearer_key, "").strip() or None
    return {"mcpServers": {server_id: _http_server_config(url, bearer)}}


# --- async-from-sync trampoline (cribbed from old notion_mcp.py) --------

async def _call_tool_async(config: Dict[str, Any], server_id: str, tool: str, args: Dict[str, Any]) -> Any:
    """Open a fresh mcp-use session, call one tool, close.

    Per-call sessions keep this stateless — important when `langgraph dev`
    cycles event loops between turns.
    """
    from mcp_use import MCPClient  # lazy import; mcp-use is heavy

    client = MCPClient.from_dict(config)
    try:
        session = await client.create_session(server_id)
        if session is None:
            raise RuntimeError(
                f"Failed to create MCP session for {server_id!r}. "
                f"Check the endpoint URL and auth token."
            )
        return await session.call_tool(tool, args)
    finally:
        try:
            await client.close_all_sessions()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass


def _run_sync(coro: Any) -> Any:
    """Run an async coroutine to completion from sync code, even when a
    parent event loop is already running.

    `langgraph dev` runs tools through a sync interface that's itself
    inside an event loop — `asyncio.run` would error with "asyncio.run()
    cannot be called from a running event loop". Detect that case and
    dispatch to a worker thread with its own fresh loop.
    """
    try:
        asyncio.get_running_loop()
        running = True
    except RuntimeError:
        running = False

    if not running:
        return asyncio.run(coro)

    result_holder: Dict[str, Any] = {}

    def _runner() -> None:
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            result_holder["value"] = loop.run_until_complete(coro)
        except Exception as e:  # noqa: BLE001
            result_holder["error"] = e
        finally:
            loop.close()

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    t.join()
    if "error" in result_holder:
        raise result_holder["error"]  # type: ignore[misc]
    return result_holder.get("value")


def _extract_payload(result: Any) -> Dict[str, Any]:
    """Normalize an MCP tool-call result into a plain dict.

    MCP servers may return:
    - structured JSON in `.structuredContent` (newer SDKs / Google's MCPs)
    - a list of content blocks with text payloads (older / community MCPs)
    """
    if result is None:
        raise RuntimeError("MCP returned no result")

    sc = getattr(result, "structuredContent", None)
    if isinstance(sc, dict) and sc:
        return sc

    content = getattr(result, "content", None)
    if not content:
        raise RuntimeError(
            f"MCP returned empty content. is_error={getattr(result, 'isError', None)} "
            f"raw={result!r}"
        )

    for block in content:
        text = getattr(block, "text", None)
        if not text:
            continue
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise RuntimeError(f"MCP error: {text}")

    raise RuntimeError(f"MCP returned no parseable text block: {result!r}")


# --- BigQuery (Google hosted) -------------------------------------------

def bq_query(sql: str) -> Dict[str, Any]:
    """Run a BigQuery SQL query via the BigQuery MCP server.

    Returns Google's standard query response shape (rows + schema).
    Raises NotConfiguredError if BIGQUERY_MCP_URL is unset.
    """
    cfg = _client_config("bigquery", "BIGQUERY_MCP_URL", "BIGQUERY_MCP_BEARER_TOKEN")
    return _extract_payload(
        _run_sync(_call_tool_async(cfg, "bigquery", "query", {"sql": sql}))
    )


# --- Cloud Run / gcloud (Google hosted) ---------------------------------

def run_list(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List Cloud Run services in a project via the gcloud MCP server."""
    project = project_id or os.getenv("GCP_PROJECT_ID", "")
    cfg = _client_config("gcloud", "GCLOUD_MCP_URL", "GCLOUD_MCP_BEARER_TOKEN")
    return _extract_payload(
        _run_sync(_call_tool_async(cfg, "gcloud", "run.services.list", {"project": project}))
    )


def run_deploy(service: str, image: str, region: str = "us-central1", project_id: Optional[str] = None) -> Dict[str, Any]:
    """Deploy a Cloud Run service from an existing image. Long-running.

    Phase 5 invokes this from inside a Daytona sandbox after building the
    container; calling it directly here is fine for re-deploys of an
    already-built image.
    """
    project = project_id or os.getenv("GCP_PROJECT_ID", "")
    cfg = _client_config("gcloud", "GCLOUD_MCP_URL", "GCLOUD_MCP_BEARER_TOKEN")
    return _extract_payload(
        _run_sync(
            _call_tool_async(
                cfg,
                "gcloud",
                "run.services.deploy",
                {"project": project, "service": service, "image": image, "region": region},
            )
        )
    )


# --- Cloudflare (community MCP) — Phase 6 stretch -----------------------

def cf_dns_create(name: str, target: str, record_type: str = "CNAME") -> Dict[str, Any]:
    """Create a DNS record in Cloudflare via the Cloudflare MCP server."""
    cfg = _client_config("cloudflare", "CLOUDFLARE_MCP_URL", "CLOUDFLARE_API_TOKEN")
    zone_id = os.getenv("CLOUDFLARE_ZONE_ID", "")
    return _extract_payload(
        _run_sync(
            _call_tool_async(
                cfg,
                "cloudflare",
                "dns.records.create",
                {"zone_id": zone_id, "name": name, "type": record_type, "content": target},
            )
        )
    )


# --- Sentinels ----------------------------------------------------------

def has_bigquery() -> bool:
    return bool(os.getenv("BIGQUERY_MCP_URL", "").strip())


def has_gcloud() -> bool:
    return bool(os.getenv("GCLOUD_MCP_URL", "").strip())


def has_cloudflare() -> bool:
    return bool(os.getenv("CLOUDFLARE_MCP_URL", "").strip())
