"""Daytona sandbox manager — one sandbox per LangGraph thread.

Each chat thread gets its own long-lived Daytona sandbox the first time
the agent calls a sandbox_* tool. The sandbox stays warm across turns
until either:
  - the LangGraph process restarts (in-memory cache dies)
  - Daytona's idle TTL expires (typically 15-60 minutes; configurable
    on the Daytona side via DAYTONA_AUTO_STOP_INTERVAL)

Why per-thread instead of per-agent-run?
  Each thread is an isolated user session — a sandbox started on turn 1
  ('git clone foo') needs to be the SAME sandbox on turn 2 ('cd foo &&
  npm install'). Per-run would lose all state.

The cache key is the LangGraph thread_id, surfaced into tools through
RunnableConfig (`config['configurable']['thread_id']`). Tools call
`get_or_create_sandbox(thread_id)` and back goes a Sandbox handle.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any, Optional


class SandboxNotConfiguredError(RuntimeError):
    """Raised when the agent tries to use sandbox tools without DAYTONA_API_KEY."""


# ---------------------------------------------------------------------------
# Daytona SDK boot — done lazily so the agent module imports stay cheap
# and a missing DAYTONA_API_KEY doesn't crash agent boot, only the first
# sandbox tool call.
# ---------------------------------------------------------------------------

_daytona_client: Optional[Any] = None
_daytona_lock = threading.Lock()


def _daytona() -> Any:
    """Return a lazy-initialized Daytona client, or raise if unconfigured."""
    global _daytona_client
    if _daytona_client is not None:
        return _daytona_client

    with _daytona_lock:
        if _daytona_client is not None:
            return _daytona_client

        api_key = os.getenv("DAYTONA_API_KEY", "").strip()
        if not api_key:
            raise SandboxNotConfiguredError(
                "DAYTONA_API_KEY is unset. Add it to apps/agent/.env "
                "(get it at app.daytona.io → API keys)."
            )

        try:
            from daytona_sdk import Daytona, DaytonaConfig  # type: ignore
        except ImportError as e:  # noqa: BLE001
            raise SandboxNotConfiguredError(
                "daytona-sdk isn't installed. Run `cd apps/agent && uv sync`."
            ) from e

        kwargs: dict[str, Any] = {"api_key": api_key}
        # Optional: server URL override (self-hosted Daytona). Most users
        # use the cloud SaaS, where the SDK picks the default endpoint.
        api_url = os.getenv("DAYTONA_API_URL", "").strip()
        if api_url:
            kwargs["api_url"] = api_url

        _daytona_client = Daytona(DaytonaConfig(**kwargs))
        return _daytona_client


# ---------------------------------------------------------------------------
# Per-thread sandbox cache
# ---------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    sandbox: Any
    sandbox_id: str
    workspace: str  # default working directory for shell commands


_cache: dict[str, _CacheEntry] = {}
_cache_lock = threading.Lock()


def _custom_image() -> Optional[str]:
    """Return DAYTONA_IMAGE override, or None to use the SDK default
    snapshot. The default snapshot already has node, python, git, etc.
    pre-installed — only override when you need a specific stack.
    """
    val = os.getenv("DAYTONA_IMAGE", "").strip()
    return val or None


def _resolve_workspace(sandbox: Any) -> str:
    """Best-effort workspace path. The SDK exposes get_work_dir() in
    0.20+; older versions don't. Falls back to /home/daytona which is
    the historical convention.
    """
    getter = getattr(sandbox, "get_work_dir", None) or getattr(
        sandbox, "get_user_home_dir", None
    )
    if callable(getter):
        try:
            value = getter()
            if isinstance(value, str) and value:
                return value
        except Exception:  # noqa: BLE001
            pass
    return "/home/daytona"


def has_daytona() -> bool:
    """Cheap presence check — used for boot-status / sentinel logic."""
    return bool(os.getenv("DAYTONA_API_KEY", "").strip())


def get_or_create_sandbox(thread_id: str) -> _CacheEntry:
    """Return a sandbox handle for `thread_id`, creating one if needed.

    First call cold-starts a fresh sandbox (~5-15s). Subsequent calls
    in the same thread are O(1) — we just return the cached handle.

    The thread_id keying ties the sandbox lifetime to the chat thread.
    Reusing a thread (via the threads drawer) reuses its sandbox. A
    new thread starts a brand-new sandbox.
    """
    if not thread_id:
        raise SandboxNotConfiguredError(
            "Cannot create a sandbox without a thread_id. The tool layer "
            "didn't pass RunnableConfig — check the @tool signature."
        )

    with _cache_lock:
        existing = _cache.get(thread_id)
        if existing is not None:
            return existing

    # Out of the lock for the slow part — first-create can take 5-15s
    # and we don't want every other thread to block on it.
    daytona = _daytona()

    # Daytona Python SDK 0.173+: Daytona.create() takes a
    # `CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams`
    # (or nothing for the default snapshot, which is the path we want
    # for almost every demo flow — it already has python, node, git).
    custom = _custom_image()
    if custom:
        try:
            from daytona_sdk import CreateSandboxFromImageParams  # type: ignore

            sandbox = daytona.create(
                CreateSandboxFromImageParams(image=custom),
                timeout=120,
            )
        except Exception as e:  # noqa: BLE001
            raise SandboxNotConfiguredError(
                f"Failed to create sandbox from DAYTONA_IMAGE={custom!r}: {e}"
            ) from e
    else:
        sandbox = daytona.create(timeout=120)

    # Sandbox.id exists as a pydantic model field on 0.173+.
    sandbox_id = getattr(sandbox, "id", None) or "<unknown>"
    workspace = _resolve_workspace(sandbox)

    entry = _CacheEntry(
        sandbox=sandbox, sandbox_id=str(sandbox_id), workspace=workspace
    )

    with _cache_lock:
        # Race-tolerant: another thread may have created one while we
        # were creating this. Keep the one that won.
        winner = _cache.setdefault(thread_id, entry)
        if winner is not entry:
            # Our work was wasted — destroy the loser asynchronously to
            # avoid leaking a paid sandbox.
            _safe_destroy(sandbox)
            return winner
        return entry


def shutdown_sandbox(thread_id: str) -> None:
    """Tear down the sandbox for a thread. Safe to call multiple times."""
    with _cache_lock:
        entry = _cache.pop(thread_id, None)
    if entry is None:
        return
    _safe_destroy(entry.sandbox)


def _safe_destroy(sandbox: Any) -> None:
    """Best-effort sandbox teardown. Don't raise — caller didn't ask."""
    for method_name in ("delete", "remove", "stop"):
        method = getattr(sandbox, method_name, None)
        if callable(method):
            try:
                method()
                return
            except Exception:  # noqa: BLE001
                continue


def shutdown_all() -> None:
    """Cleanup hook for graceful shutdown. Not currently wired but
    handy when the agent process exits."""
    with _cache_lock:
        entries = list(_cache.values())
        _cache.clear()
    for entry in entries:
        _safe_destroy(entry.sandbox)
