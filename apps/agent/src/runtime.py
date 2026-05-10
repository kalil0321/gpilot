"""Switchable runtime factory for the gpilot agent.

There's ONE compiled graph per process — deepagents planner + the
standard middleware chain (TimingMiddleware first so it sees every
inner model/tool call, then GCPStateMiddleware for the canvas-state
TypedDict, then CopilotKitMiddleware for AG-UI/CopilotKit interop,
then ModelDispatchMiddleware for per-request model swap).

DEFAULT model = gemini-flash-lite-latest (a real `BaseChatModel`
returned by `init_chat_model`). PER-REQUEST model switching happens
in `ModelDispatchMiddleware`: the frontend ModelSelector ships a
`{provider, model}` pair in `forwardedProps.config.configurable`,
AG-UI's LangGraph adapter merges that into the run's runnable config,
and the middleware overrides `request.model` for that turn.

Supported providers/models (must mirror the frontend selector — see
`apps/frontend/src/components/chat/ModelSelector.tsx`):
  google_genai → gemini-flash-lite-latest, gemini-flash-latest,
                 gemini-pro-latest
  anthropic    → claude-sonnet-4-6, claude-opus-4-7
  openai       → gpt-5.3-codex, gpt-5.4

Adding a provider: `init_chat_model` already supports
openai/anthropic/google_genai out of the box. Just add the model id
to `SUPPORTED_MODELS` here AND to `MODEL_OPTIONS` in the frontend
selector.

`AGENT_RUNTIME` env var selects the AGENT TOPOLOGY (deep vs react)
but does not pin the model. `noop` is preserved for the
"no API key configured" boot path.
"""

from __future__ import annotations

import os
from typing import Literal

from langgraph.graph.state import CompiledStateGraph

from copilotkit import CopilotKitMiddleware

from .gcp_state import GCPStateMiddleware
from .model_dispatch import ModelDispatchMiddleware
from .timing import TimingMiddleware


RuntimeName = Literal[
    "gemini-flash-deep",      # default — deepagents + per-request configurable model
    "gemini-flash-react",     # react agent + per-request configurable model
    "claude-sonnet-4-6-react",  # legacy alias for the react topology
    "noop",                   # API-key-missing fallback
]


_VALID_RUNTIMES = (
    "gemini-flash-deep",
    "gemini-flash-react",
    "claude-sonnet-4-6-react",
    "noop",
)


# Models the frontend selector is allowed to pick. Each entry is
# `(provider, model_id, label)`. The frontend mirrors this list (see
# `apps/frontend/src/components/chat/ModelSelector.tsx`); keeping them
# in sync is a manual chore but only happens when we explicitly choose
# to add/remove a model.
SUPPORTED_MODELS: tuple[tuple[str, str, str], ...] = (
    # Google — rolling latest aliases auto-track the newest stable per tier.
    ("google_genai", "gemini-flash-lite-latest", "Gemini Flash Lite (latest)"),
    ("google_genai", "gemini-flash-latest", "Gemini Flash (latest)"),
    ("google_genai", "gemini-pro-latest", "Gemini Pro (latest)"),
    # Anthropic — Claude 4.x line.
    ("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("anthropic", "claude-opus-4-7", "Claude Opus 4.7"),
    # OpenAI — model ids per the user's selection.
    ("openai", "gpt-5.3-codex", "GPT-5.3 Codex"),
    ("openai", "gpt-5.4", "GPT-5.4"),
)

DEFAULT_PROVIDER = "google_genai"
DEFAULT_MODEL = "gemini-flash-lite-latest"


# Default message for the noop fallback runtime. Phrasing is verbatim from
# the phase-05 acceptance criteria: a missing GEMINI_API_KEY must surface a
# 3s reply with this text instead of hanging on "thinking…".
NOOP_FALLBACK_MESSAGE = (
    "Set `GEMINI_API_KEY` in agent/.env to enable the agent. "
    "The starter is otherwise fully wired and will work as soon as you add a key."
)


def build_graph(
    runtime: str,
    *,
    tools: list,
    system_prompt: str,
) -> CompiledStateGraph:
    """Compile the graph. The `runtime` arg picks the AGENT TOPOLOGY
    (deep vs react), not the model — model selection happens per
    request via `forwardedProps.config.configurable.agent_model`.

    Args:
        runtime: One of `gemini-flash-deep`, `gemini-flash-react`,
            `claude-sonnet-4-6-react` (alias for react). Anything else
            falls back to `gemini-flash-deep` with a warning.
        tools: Backend tools to bind. Frontend tools are forwarded by
            `CopilotKitMiddleware` at run time and must NOT appear here.
        system_prompt: Already-composed system prompt.
    """
    if runtime not in _VALID_RUNTIMES:
        print(
            f"[runtime] WARN: unknown AGENT_RUNTIME={runtime!r}; "
            f"falling back to gemini-flash-deep",
            flush=True,
        )
        runtime = "gemini-flash-deep"

    timing = TimingMiddleware()
    gcp_state = GCPStateMiddleware()
    copilotkit = CopilotKitMiddleware()
    # ModelDispatchMiddleware sits in the middleware chain so it sees
    # every model call and can swap `request.model` based on the user's
    # frontend selection (forwardedProps.config.configurable). Order
    # within the list doesn't matter for model swap, but we put it
    # AFTER copilotkit so its tool-merge runs first on the bound model.
    model_dispatch = ModelDispatchMiddleware()
    middleware = [timing, gcp_state, copilotkit, model_dispatch]

    if runtime == "noop":
        return _build_noop(NOOP_FALLBACK_MESSAGE)
    if runtime == "gemini-flash-deep":
        return _build_deep(tools, system_prompt, middleware)
    if runtime in ("gemini-flash-react", "claude-sonnet-4-6-react"):
        return _build_react(tools, system_prompt, middleware)

    raise RuntimeError(f"unreachable runtime branch: {runtime!r}")


# ---------------------------------------------------------------------- noop

# Module-level state schema for the noop graph. Defined outside `_build_noop`
# so `get_type_hints(_NoopState)` can resolve the `Annotated[list,
# add_messages]` forward ref.
from langgraph.graph.message import add_messages as _add_messages
from typing_extensions import Annotated as _Annotated, TypedDict as _TypedDict


class _NoopState(_TypedDict):
    messages: _Annotated[list, _add_messages]


def _build_noop(message: str) -> CompiledStateGraph:
    """Build a no-LLM fallback graph that always replies `message`.

    Used when GEMINI_API_KEY is missing or stub — instead of letting the
    real Gemini runtime boot and hang on the first turn with an opaque
    auth error, we register this graph so the chat answers in <1s with a
    pointer at the fix.
    """
    from langchain_core.messages import AIMessage
    from langgraph.graph import END, START, StateGraph

    def _respond(_state: _NoopState) -> dict:
        return {"messages": [AIMessage(content=message, id="noop-fallback")]}

    graph = StateGraph(_NoopState)
    graph.add_node("respond", _respond)
    graph.add_edge(START, "respond")
    graph.add_edge("respond", END)
    return graph.compile()


# ----------------------------------------------------------- configurable model


def _build_chat_model():
    """Build the agent's DEFAULT chat model — a real `BaseChatModel`
    instance that deepagents / create_agent accept directly.

    Per-request switching to a different provider/model happens in
    `ModelDispatchMiddleware`, which reads
    `runnable_config.configurable.agent_model` (set by the frontend
    ModelSelector via `forwardedProps.config.configurable`) and swaps
    `request.model` for that turn. `_get_bound_model` downstream
    re-binds tools to whichever model we returned, so we don't need to
    pre-bind anything here.

    Why not `init_chat_model(..., configurable_fields=("model",))`:
    that returns a `_ConfigurableModel` wrapper that is NOT a
    `BaseChatModel`, and deepagents' `resolve_model()` rejects it
    with `AttributeError: count is not a BaseChatModel attribute`.
    The middleware path sidesteps that whole class hierarchy issue.

    Auth keys are read from the standard env var per provider:
        GOOGLE_API_KEY / GEMINI_API_KEY  (google_genai)
        ANTHROPIC_API_KEY                (anthropic)
        OPENAI_API_KEY                   (openai)
    A missing key surfaces only when that provider is actually invoked,
    not at boot.
    """
    from langchain.chat_models import init_chat_model

    # Mirror GEMINI_API_KEY → GOOGLE_API_KEY (langchain reads the latter).
    if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

    return init_chat_model(
        DEFAULT_MODEL,
        model_provider=DEFAULT_PROVIDER,
        temperature=0,
    )


# --------------------------------------------------------------------- builders


def _build_deep(
    tools: list, system_prompt: str, middleware: list
) -> CompiledStateGraph:
    """Default: deepagents planner with a per-request-configurable model."""
    from deepagents import create_deep_agent

    llm = _build_chat_model()
    return create_deep_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        middleware=middleware,
    )


def _build_react(
    tools: list, system_prompt: str, middleware: list
) -> CompiledStateGraph:
    """Plain `create_agent` (the new react agent factory) with the
    same per-request-configurable model. Useful for benchmarking
    deepagents' planner overhead vs the model itself."""
    from langchain.agents import create_agent

    llm = _build_chat_model()
    return create_agent(
        model=llm,
        tools=tools,
        system_prompt=system_prompt,
        middleware=middleware,
    )
