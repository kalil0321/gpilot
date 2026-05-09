"""LangGraph entry point for `langgraph dev --port 8133`.

Wires:
- A switchable runtime (Gemini Flash-Lite + deepagents | Gemini Flash-Lite + react |
  Claude Sonnet 4.6 + react) selected by `AGENT_RUNTIME`. See
  `src/runtime.py` and the README's "Switching to a different model".
- GCP-MCP-backed backend tools (Phase 2+; Phase 1 ships an empty list).
- TimingMiddleware (per-turn wall-time logging — see `src/timing.py`)
- GCPStateMiddleware + CopilotKitMiddleware for canvas state + AG-UI

Frontend tools (state mutators) are declared on the React side via
`useFrontendTool({ name, parameters, handler })`. The runtime forwards
those declarations into the agent's tool list at run time, so we
deliberately do NOT include the Python `frontend_tool_stubs` here —
adding them would cause Gemini to reject the request with "Duplicate
function declaration found: <name>". The Python stubs in
`agent/src/canvas.py` exist purely as documentation of the contract the
frontend is expected to honor.
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

from src.gcp_store import boot_status as _gcp_store_boot_status
from src.gcp_tools import load_gcp_tools
from src.intelligence_cleanup import wipe_orphan_threads
from src.prompts import build_system_prompt
from src.runtime import build_graph


# Load .env early so GEMINI_API_KEY / NOTION_TOKEN / ANTHROPIC_API_KEY are visible.
load_dotenv()


# `langchain_google_genai._function_utils` logs a warning every time it
# converts a tool schema that contains Pydantic v2's `$schema` /
# `$defs` / `title` meta-keys. The conversion still works (the keys
# get silently ignored downstream) — the noise just clutters every
# turn. We filter that one log message at boot so the agent log stays
# focused on actual problems.
class _GeminiSchemaNoiseFilter(logging.Filter):
    _NOISY_FRAGMENTS = ("'$schema'", "'$defs'", "'title'")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        if "is not supported in schema" not in msg:
            return True
        return not any(frag in msg for frag in self._NOISY_FRAGMENTS)


logging.getLogger("langchain_google_genai._function_utils").addFilter(
    _GeminiSchemaNoiseFilter()
)


# `langgraph dev` uses an in-memory checkpoint store, so every agent boot
# starts with zero threads in LangGraph but the Intelligence Postgres
# still holds the chat history from the previous run. Without this
# cleanup, the next `getCheckpointByMessage` lookup throws "Message not
# found" and surfaces in the UI as an opaque rxjs stack trace.
# See `src/intelligence_cleanup.py` for the full rationale.
wipe_orphan_threads()


def _format_integration_status() -> str:
    """Run the boot-time GCP-store health check and format a status string.

    Reports whichever source is active — live GCP (BigQuery + Cloud Run)
    when creds are set, the bundled seed JSON otherwise. The returned
    string is interpolated into the system prompt so the agent can
    refuse-with-reason when something is off rather than silently
    returning an empty canvas.
    """
    try:
        line = _gcp_store_boot_status()
    except Exception as e:  # noqa: BLE001 - never block agent boot on this
        print(f"[gcp_store] FAILED: {e}", flush=True)
        return f"error: gcp_store boot_status raised: {e}"

    print(f"[gcp_store] {line}", flush=True)
    return line


# Stub-key warnings for the active runtime live closer to the runtime selector.
# The Gemini runtimes still warn here so the message is loud at boot.
_AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "gemini-flash-deep")
print(f"[runtime] AGENT_RUNTIME={_AGENT_RUNTIME}", flush=True)

_gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
if _AGENT_RUNTIME.startswith("gemini-") and (
    not _gemini_key or _gemini_key.startswith("stub")
):
    print(
        "\n  GEMINI_API_KEY is unset or a stub.\n"
        "   The agent will boot but chat will fail on the first turn.\n"
        "   Get a key at https://aistudio.google.com → Get API key,\n"
        "   then set GEMINI_API_KEY in v2/.env and v2/agent/.env.\n",
        flush=True,
    )


backend_tools = load_gcp_tools()


_integration_status = _format_integration_status()
SYSTEM_PROMPT = build_system_prompt(_integration_status)


_use_noop = (
    _AGENT_RUNTIME.startswith("gemini-")
    and (not _gemini_key or _gemini_key.startswith("stub"))
)
if _use_noop:
    print(
        "\n[runtime] GEMINI_API_KEY missing or stub — using noop fallback graph.\n"
        "          Chat will reply with a setup pointer instead of hanging.\n",
        flush=True,
    )

# Frontend tools are NOT listed here — see module docstring.
graph = build_graph(
    "noop" if _use_noop else _AGENT_RUNTIME,
    tools=backend_tools,
    system_prompt=SYSTEM_PROMPT,
)


def main() -> None:
    """Entry point for `uv run dev` / `python -m agent`.

    `langgraph dev` is the canonical local-dev runner — this just exists to
    satisfy the `[project.scripts] dev = "agent:main"` entry point.
    """
    import subprocess

    subprocess.run(
        ["langgraph", "dev", "--port", "8133"],
        check=True,
    )


if __name__ == "__main__":
    main()
