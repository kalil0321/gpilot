"""System prompt loader for the gpilot agent.

The actual prompt content lives as Markdown files in `src/prompts/`,
one file per concern (identity, state shapes, integration, tools,
widget spec, reference patterns, response rules). At boot we
concatenate them in alphanumeric order — that's why each file is
prefixed with a 2-digit ordinal (`01-…`, `02-…`, etc.) — and inject
the live integration status into the one section that needs it.

Why .md instead of inline Python strings:
- diffs are readable (no `"...\n"` clutter)
- syntax highlighting in the editor
- non-Python contributors can edit without learning the codebase
- swapping/A-B-testing a section is just renaming a file

Adding a new section: drop a new `NN-name.md` in `src/prompts/`. Pick
a number that orders it where you want. The loader auto-picks it up.
Use `{status}` (or any other Python `str.format` placeholder added
to `_TEMPLATE_VARS`) to inject runtime values.
"""

from __future__ import annotations

from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parent


def _read_section(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip()


def build_system_prompt(integration_status: str) -> str:
    """Compose the full system prompt by concatenating every Markdown
    file in `src/prompts/` (sorted by filename) and injecting the live
    integration status.

    Args:
        integration_status: One-line health summary from
            `gcp_store.boot_status()`. Surfaced inside the prompt so the
            agent can pattern-match on `project=…` / `billing_dataset=…`
            when composing BigQuery SQL.
    """
    sections = sorted(_PROMPTS_DIR.glob("*.md"))
    if not sections:
        # Defensive — should never happen in checked-out source. The
        # agent would still boot but with a useless prompt.
        return f"# gpilot\n\n(empty prompt — no .md sections in {_PROMPTS_DIR})"

    body = "\n\n".join(_read_section(s) for s in sections)
    # Only do `.format()` on the slice that contains the placeholder
    # to avoid choking on incidental `{` characters in code examples.
    if "{status}" in body:
        body = body.replace("{status}", integration_status)
    return body
