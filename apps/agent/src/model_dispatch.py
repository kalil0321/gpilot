"""Per-request chat-model dispatch middleware.

The frontend's ModelSelector ships a chosen `{provider, model}` pair
in `forwardedProps.config.configurable.{agent_model_provider,
agent_model}`. The AG-UI LangGraph adapter mirrors that into the
LangGraph 0.6 `context` object (see the BFF wrap in
`apps/bff/src/server.ts` for why we strip `configurable` and rely on
`context` only). This middleware reads those values inside
`awrap_model_call` and overrides `request.model` for that turn.

Why a middleware (not a configurable model wrapper):
- `init_chat_model(..., configurable_fields=("model",))` returns a
  `_ConfigurableModel` Runnable that's NOT a `BaseChatModel`, and
  deepagents' `resolve_model()` rejects it with a confusing
  `AttributeError: count is not a BaseChatModel attribute …`.
- Subclassing `BaseChatModel` to wrap the configurable model works
  but pulls in pydantic-v2 abstract-method ceremony.
- Middleware is the cleanest fit: `langchain.agents._get_bound_model`
  calls `request.model.bind_tools(...)` per-turn anyway, so any
  unbound `BaseChatModel` we return from the middleware will get
  tools attached automatically. No pre-binding, no subclass.

Read order: `request.runtime.context` first (the new LangGraph 0.6
runtime context), then `get_config().configurable` (legacy fallback,
used by setups that bypass the BFF strip). Whichever has values wins.

Cache: each `(provider, model_id)` pair is initialised once and reused
across turns. Thread-safe via a lock so concurrent runs don't double-
init the same model.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Optional

from langchain.agents.middleware import AgentMiddleware
from langchain.chat_models import init_chat_model
from langgraph.config import get_config


def _coerce_lookup(obj: Any, key: str) -> Any:
    """Best-effort lookup that handles dicts, dataclasses, and pydantic.

    `Runtime.context` can be any of those depending on whether the
    graph defined a context schema. We accept all three.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


class ModelDispatchMiddleware(AgentMiddleware):
    """Swap `request.model` based on the runnable config."""

    def __init__(self) -> None:
        super().__init__()
        self._cache: dict[str, Any] = {}
        self._lock = threading.Lock()

    # ----- helpers --------------------------------------------------------

    def _get_model(self, provider: str, model_id: str) -> Any:
        key = f"{provider}:{model_id}"
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            model = init_chat_model(
                model_id,
                model_provider=provider,
                temperature=0,
            )
            self._cache[key] = model
            return model

    def _resolve_override(self, request: Any) -> Optional[tuple[str, str]]:
        """Read the user's model choice from `runtime.context` (or the
        legacy `configurable` as a fallback).

        Returns (provider, model_id) if the user has picked one, else
        None — in which case the agent uses its bound default model.
        """
        # Primary: LangGraph 0.6+ runtime context (what the AG-UI
        # adapter populates after the BFF strip).
        ctx = getattr(getattr(request, "runtime", None), "context", None)
        provider = _coerce_lookup(ctx, "agent_model_provider")
        model_id = _coerce_lookup(ctx, "agent_model")

        # Fallback: legacy `configurable` for setups that don't go
        # through the BFF strip (e.g. direct `langgraph dev` calls).
        if not provider or not model_id:
            try:
                cfg = get_config() or {}
                configurable = cfg.get("configurable") or {}
                provider = provider or configurable.get("agent_model_provider")
                model_id = model_id or configurable.get("agent_model")
            except Exception:  # noqa: BLE001 — get_config raises outside a run
                pass

        if not provider or not model_id:
            return None
        if not isinstance(provider, str) or not isinstance(model_id, str):
            return None
        return provider, model_id

    def _maybe_override(self, request: Any) -> Any:
        """Return either a `request.override(model=...)` or the original."""
        override = self._resolve_override(request)
        if override is None:
            return request
        provider, model_id = override
        try:
            new_model = self._get_model(provider, model_id)
        except Exception as e:  # noqa: BLE001
            print(
                f"[model_dispatch] init_chat_model({provider}:{model_id}) "
                f"failed, falling back to default: {e}",
                flush=True,
            )
            return request
        return request.override(model=new_model)

    # ----- middleware hooks ----------------------------------------------

    def wrap_model_call(
        self, request: Any, handler: Callable[[Any], Any]
    ) -> Any:
        return handler(self._maybe_override(request))

    async def awrap_model_call(
        self, request: Any, handler: Callable[[Any], Any]
    ) -> Any:
        return await handler(self._maybe_override(request))
