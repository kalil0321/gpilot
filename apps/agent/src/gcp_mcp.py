"""mcp-use clients for the official gcloud-mcp + an optional BigQuery MCP.

**Persistent-session model (perf):** each MCP server type gets one
long-lived worker thread that owns its asyncio event loop and a single
mcp-use session. Calls dispatch via a thread-safe queue and return
through `concurrent.futures.Future`. The MCP subprocess (e.g. `npx -y
@google-cloud/gcloud-mcp`) boots once, on the first call, and stays
warm for the lifetime of the agent process.

Cold-start cost (first call after agent boot) ≈ 2-3s.
Warm cost (subsequent calls)                  ≈ 100-300ms.

When `langgraph dev` reloads the module, the workers die with the old
process. The next call lazily spins up a new worker.

ENDPOINT CONFIG via env (all optional; unset → seed-only mode):
- GCLOUD_MCP_COMMAND   override for the gcloud-mcp launch command
                       (default `npx -y @google-cloud/gcloud-mcp`).
- BIGQUERY_MCP_COMMAND launch command for a community BigQuery MCP
                       (e.g. `npx -y @ergut/mcp-bigquery-server …`).
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import queue
import shutil
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()


# Default launch command for the official gcloud MCP server. Override
# with GCLOUD_MCP_COMMAND if you want to pin a version, use a local
# tarball, or swap in a fork.
_DEFAULT_GCLOUD_MCP_CMD = "npx -y @google-cloud/gcloud-mcp"

# How long to wait for the worker's first session to become ready
# before raising. The cold start of `npx -y @google-cloud/gcloud-mcp`
# can take 4-6s on a cold npm cache.
_WORKER_BOOT_TIMEOUT = 30.0


class NotConfiguredError(RuntimeError):
    """Raised when an MCP path is invoked but its config is unset.

    Caught by `gcp_store` so the seed fallback kicks in cleanly.
    """


# --- Config builders ----------------------------------------------------

def _split_cmd(cmd: str) -> tuple[str, List[str]]:
    """Split a full command string ('npx -y @foo/bar') into (program, args)."""
    parts = cmd.strip().split()
    if not parts:
        raise NotConfiguredError("MCP command is empty.")
    return parts[0], parts[1:]


def _stdio_server_config(
    cmd: str, env: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Build the inner-server dict shape mcp-use's `from_dict` expects
    for stdio transport (presence of `"command"` selects StdioConnector).
    """
    program, args = _split_cmd(cmd)
    cfg: Dict[str, Any] = {"command": program, "args": args}
    if env:
        cfg["env"] = env
    return cfg


def _gcloud_config() -> Dict[str, Any]:
    cmd = os.getenv("GCLOUD_MCP_COMMAND", "").strip() or _DEFAULT_GCLOUD_MCP_CMD
    return {"mcpServers": {"gcloud": _stdio_server_config(cmd)}}


def _bigquery_config() -> Dict[str, Any]:
    cmd = os.getenv("BIGQUERY_MCP_COMMAND", "").strip()
    if not cmd:
        raise NotConfiguredError(
            "BIGQUERY_MCP_COMMAND is unset. Set it to your BigQuery MCP "
            "launch command (e.g. 'npx -y @ergut/mcp-bigquery-server …'), "
            "or rely on the seeded fallback in gcp_store."
        )
    project = os.getenv("GCP_PROJECT_ID", "")
    env = {"BIGQUERY_PROJECT_ID": project} if project else None
    return {"mcpServers": {"bigquery": _stdio_server_config(cmd, env=env)}}


# --- Persistent MCP worker ----------------------------------------------

class _MCPWorker:
    """Long-lived thread with an asyncio loop and one MCP session.

    `call(tool, args)` is sync from the caller's perspective: it pushes
    a job onto the worker's queue and blocks on a Future for the result.
    The worker thread runs the actual `session.call_tool` inside its own
    event loop, then sends the result back via the Future.

    On first construction, the thread:
      1. Creates a fresh event loop
      2. Spawns the MCP subprocess via `MCPClient.from_dict(...)`
      3. Opens a session
      4. Sets `_ready` so callers can proceed
    Any boot error sets `_error` and is re-raised to every subsequent
    `call(...)`.
    """

    def __init__(self, config: Dict[str, Any], server_id: str) -> None:
        self._config = config
        self._server_id = server_id
        self._queue: queue.Queue[Optional[tuple[concurrent.futures.Future, str, Dict[str, Any]]]] = queue.Queue()
        self._ready = threading.Event()
        self._error: Optional[BaseException] = None
        self._thread = threading.Thread(
            target=self._run,
            name=f"mcp-worker[{server_id}]",
            daemon=True,
        )
        self._thread.start()

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        client = None
        session = None
        try:
            from mcp_use import MCPClient  # lazy: heavy import

            client = MCPClient.from_dict(self._config)
            session = loop.run_until_complete(
                client.create_session(self._server_id)
            )
            if session is None:
                raise RuntimeError(
                    f"Failed to create MCP session for {self._server_id!r}."
                )
        except BaseException as e:  # noqa: BLE001
            self._error = e
            self._ready.set()
            return
        self._ready.set()

        # Main loop — one request at a time. The MCP protocol is
        # request/response, so serialization here is correct.
        while True:
            item = self._queue.get()
            if item is None:  # shutdown sentinel
                break
            future, tool, args = item
            if future.cancelled():
                continue
            try:
                result = loop.run_until_complete(session.call_tool(tool, args))
                future.set_result(result)
            except BaseException as e:  # noqa: BLE001
                future.set_exception(e)

        try:
            if client is not None:
                loop.run_until_complete(client.close_all_sessions())
        except Exception:  # noqa: BLE001
            pass
        loop.close()

    def call(self, tool: str, args: Dict[str, Any], timeout: float = 60.0) -> Any:
        # Wait for the worker to finish booting (session opened or error).
        if not self._ready.wait(timeout=_WORKER_BOOT_TIMEOUT):
            raise RuntimeError(
                f"MCP worker for {self._server_id!r} did not become ready in "
                f"{_WORKER_BOOT_TIMEOUT}s — check the launch command."
            )
        if self._error is not None:
            raise self._error
        f: concurrent.futures.Future = concurrent.futures.Future()
        self._queue.put((f, tool, args))
        return f.result(timeout=timeout)

    def shutdown(self) -> None:
        self._queue.put(None)


# Module-level worker registry. Lazy-init on first `_get_worker(...)`.
_workers: Dict[str, _MCPWorker] = {}
_workers_lock = threading.Lock()


def _get_worker(server_id: str, config_factory: Callable[[], Dict[str, Any]]) -> _MCPWorker:
    """Return a live worker for `server_id`, creating one on demand.

    The config_factory is only called when we actually need to build
    a new worker — that's where `NotConfiguredError` may surface.
    """
    with _workers_lock:
        w = _workers.get(server_id)
        if w is None or not w._thread.is_alive():
            w = _MCPWorker(config_factory(), server_id)
            _workers[server_id] = w
        return w


def _extract_payload(result: Any) -> Any:
    """Normalize an MCP tool-call result.

    Returns parsed JSON when the server emits structured content, or
    the raw text content when it's not JSON. Raises on errored results.
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
            if getattr(result, "isError", False):
                raise RuntimeError(f"MCP error: {text}")
            return text

    raise RuntimeError(f"MCP returned no parseable content: {result!r}")


# --- gcloud (official) --------------------------------------------------

def gcloud_run(command: str) -> Any:
    """Execute a gcloud CLI command via the official gcloud-mcp.

    Args:
        command: The CLI invocation MINUS the leading `gcloud `.
            e.g. "run services list --format=json --project=foo".

    Returns: parsed JSON when the command emits JSON, else raw stdout.
    Raises NotConfiguredError when gcloud isn't authenticated.

    Cold-start cost (first call): ~3s. Warm cost: ~150-500ms depending
    on the gcloud command itself.
    """
    if not is_gcloud_authenticated():
        raise NotConfiguredError(
            "gcloud isn't authenticated. Run `gcloud auth application-default "
            "login` and re-try."
        )
    worker = _get_worker("gcloud", _gcloud_config)
    args = command.strip().split()
    return _extract_payload(
        worker.call("run_gcloud_command", {"args": args})
    )


# --- BigQuery (community, optional) -------------------------------------

def bq_query(sql: str) -> Dict[str, Any]:
    """Run a BigQuery SQL query via the configured BigQuery MCP.

    Returns the MCP server's response (shape varies by server). Raises
    NotConfiguredError when BIGQUERY_MCP_COMMAND is unset.
    """
    worker = _get_worker("bigquery", _bigquery_config)
    return _extract_payload(worker.call("query", {"sql": sql}))


# --- Sentinels ----------------------------------------------------------

def is_gcloud_authenticated() -> bool:
    """Best-effort check that ADC is set up."""
    adc_path = (
        Path(os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")).expanduser()
        if os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        else Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
    )
    if not adc_path.is_file():
        return False
    if os.getenv("GCLOUD_MCP_COMMAND", "").strip():
        return True
    return shutil.which("npx") is not None


def has_bigquery() -> bool:
    return bool(os.getenv("BIGQUERY_MCP_COMMAND", "").strip())


def has_gcloud() -> bool:
    return is_gcloud_authenticated() and bool(os.getenv("GCP_PROJECT_ID", "").strip())
