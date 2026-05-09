"""mcp-use clients for the official gcloud-mcp + an optional BigQuery MCP.

Two MCP servers, both spawned over stdio (the supported launch mode for
Google's official gcloud-mcp and the community BigQuery MCPs):

- **gcloud**     `npx -y @google-cloud/gcloud-mcp` — single tool
                 `run_gcloud_command(command)` that passes a string to
                 the gcloud CLI. Auth via Application Default Credentials
                 (`gcloud auth application-default login`). Used for
                 Cloud Run inventory, project info, IAM, etc.

- **bigquery**   any community BQ MCP (e.g. `mcp-bigquery-server`,
                 `googleapis/mcp-toolbox`). Spawn command is configured
                 via the `BIGQUERY_MCP_COMMAND` env var; unset → no live
                 BigQuery and `gcp_store` falls through to seed for
                 billing rollups.

The async-from-sync trampoline + payload normalization are cribbed
verbatim from the deleted notion_mcp.py — they handle `langgraph dev`'s
sync-on-async tool execution path and the two MCP response shapes
(structuredContent vs text-block JSON).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()


# Default launch command for the official gcloud MCP server. Override
# with GCLOUD_MCP_COMMAND if you want to pin a version, use a local
# tarball, or swap in a fork.
_DEFAULT_GCLOUD_MCP_CMD = "npx -y @google-cloud/gcloud-mcp"


class NotConfiguredError(RuntimeError):
    """Raised when an MCP path is invoked but its config is unset.

    Caught by `gcp_store` so the seed fallback kicks in cleanly instead
    of bubbling up as a 500.
    """


# --- Config builders ----------------------------------------------------

def _split_cmd(cmd: str) -> tuple[str, List[str]]:
    """Split a full command string ('npx -y @foo/bar') into (program, args).

    Trivial whitespace split — sufficient for the launch commands we
    expect; non-trivial quoting is the user's problem (and they can use
    GCLOUD_MCP_COMMAND_PROGRAM / GCLOUD_MCP_COMMAND_ARGS to bypass).
    """
    parts = cmd.strip().split()
    if not parts:
        raise NotConfiguredError("MCP command is empty.")
    return parts[0], parts[1:]


def _stdio_server_config(cmd: str, env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Build the inner-server dict shape mcp-use's `from_dict` expects
    for stdio transport (the presence of `"command"` selects StdioConnector).
    """
    program, args = _split_cmd(cmd)
    cfg: Dict[str, Any] = {"command": program, "args": args}
    if env:
        cfg["env"] = env
    return cfg


def _gcloud_config() -> Dict[str, Any]:
    """Compose the mcp-use config for the gcloud MCP. Always available
    (the npx fetch + ADC authentication happens inside the server)."""
    cmd = os.getenv("GCLOUD_MCP_COMMAND", "").strip() or _DEFAULT_GCLOUD_MCP_CMD
    return {"mcpServers": {"gcloud": _stdio_server_config(cmd)}}


def _bigquery_config() -> Dict[str, Any]:
    """Compose the mcp-use config for the BigQuery MCP, or raise.

    BigQuery MCP is optional — unset means we fall through to seed for
    billing. The user picks whichever community BQ MCP they prefer; we
    just need the launch command in BIGQUERY_MCP_COMMAND.
    """
    cmd = os.getenv("BIGQUERY_MCP_COMMAND", "").strip()
    if not cmd:
        raise NotConfiguredError(
            "BIGQUERY_MCP_COMMAND is unset. Set it to your BigQuery MCP "
            "launch command (e.g. 'npx -y mcp-bigquery-server'), or rely "
            "on the seeded fallback in gcp_store."
        )
    project = os.getenv("GCP_PROJECT_ID", "")
    env = {"BIGQUERY_PROJECT_ID": project} if project else None
    return {"mcpServers": {"bigquery": _stdio_server_config(cmd, env=env)}}


# --- async-from-sync trampoline (verbatim from deleted notion_mcp.py) ---

async def _call_tool_async(
    config: Dict[str, Any], server_id: str, tool: str, args: Dict[str, Any]
) -> Any:
    """Open a fresh mcp-use session, call one tool, close.

    Per-call sessions keep this stateless — important when `langgraph dev`
    cycles event loops between turns.
    """
    from mcp_use import MCPClient  # lazy: mcp-use is heavy

    client = MCPClient.from_dict(config)
    try:
        session = await client.create_session(server_id)
        if session is None:
            raise RuntimeError(
                f"Failed to create MCP session for {server_id!r}. "
                f"Check the launch command and (for gcloud) ADC."
            )
        return await session.call_tool(tool, args)
    finally:
        try:
            await client.close_all_sessions()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass


def _run_sync(coro: Any) -> Any:
    """Run an async coroutine to completion from sync code, even when
    a parent event loop is already running.

    `langgraph dev` runs tools through a sync interface that's itself
    inside an event loop — `asyncio.run` would error with
    "asyncio.run() cannot be called from a running event loop".
    Detect that and dispatch to a worker thread with its own loop.
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


def _extract_payload(result: Any) -> Any:
    """Normalize an MCP tool-call result.

    Returns the parsed JSON payload (`dict` or `list`) when the server
    emits structured content, or the raw text content when it's not
    JSON. Raises with the server's error text on errored results.
    """
    if result is None:
        raise RuntimeError("MCP returned no result")

    sc = getattr(result, "structuredContent", None)
    if isinstance(sc, (dict, list)) and sc:
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
            # gcloud-mcp returns CLI stdout as plain text on success and
            # error messages on failure — surface as text.
            if getattr(result, "isError", False):
                raise RuntimeError(f"MCP error: {text}")
            return text

    raise RuntimeError(f"MCP returned no parseable content: {result!r}")


# --- gcloud (official) --------------------------------------------------

def gcloud_run(command: str) -> Any:
    """Execute a gcloud CLI command via the official gcloud-mcp.

    Args:
        command: The CLI invocation MINUS the leading `gcloud `.
            e.g. "run services list --format=json --project=foo"
            or "projects list --format=json".

    Returns: parsed JSON when the command emits JSON, else raw stdout.
    Raises NotConfiguredError when gcloud isn't authenticated.

    The official `@google-cloud/gcloud-mcp` tool signature takes
    `{args: string[]}` (verified against v1.x — passing `command` as
    a single string yields a Zod 'args required' error). We split on
    whitespace; non-trivial quoting isn't currently supported.
    """
    if not is_gcloud_authenticated():
        raise NotConfiguredError(
            "gcloud isn't authenticated. Run `gcloud auth application-default "
            "login` and re-try."
        )
    args = command.strip().split()
    return _extract_payload(
        _run_sync(
            _call_tool_async(
                _gcloud_config(),
                "gcloud",
                "run_gcloud_command",
                {"args": args},
            )
        )
    )


# --- BigQuery (community, optional) -------------------------------------

def bq_query(sql: str) -> Dict[str, Any]:
    """Run a BigQuery SQL query via the configured BigQuery MCP.

    Returns the MCP server's response (shape varies by server). Raises
    NotConfiguredError when BIGQUERY_MCP_COMMAND is unset.
    """
    config = _bigquery_config()  # may raise NotConfiguredError
    return _extract_payload(
        _run_sync(
            _call_tool_async(config, "bigquery", "query", {"sql": sql})
        )
    )


# --- Sentinels ----------------------------------------------------------

def is_gcloud_authenticated() -> bool:
    """Best-effort check that ADC is set up.

    Two signals:
    - `gcloud` is on PATH (or GCLOUD_MCP_COMMAND is overridden — assume yes)
    - the ADC credentials file exists at the standard location
    Either returns False → callers fall through to seed.
    """
    adc_path = (
        Path(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")).expanduser()
        if os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        else Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
    )
    if not adc_path.is_file():
        return False
    # If the user overrode the command, assume they know what they're doing
    # (the command might run in Docker or a remote sandbox).
    if os.getenv("GCLOUD_MCP_COMMAND", "").strip():
        return True
    # Otherwise we need npx (and underneath, gcloud) to be reachable.
    return shutil.which("npx") is not None


def has_bigquery() -> bool:
    return bool(os.getenv("BIGQUERY_MCP_COMMAND", "").strip())


def has_gcloud() -> bool:
    return is_gcloud_authenticated() and bool(os.getenv("GCP_PROJECT_ID", "").strip())
