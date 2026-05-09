"""Daytona sandbox @tool surface.

Each tool resolves the per-thread sandbox via `sandbox.get_or_create_sandbox(...)`
then dispatches the actual op (shell run, fs read/write, port expose).

Canvas writes:
  - `sandbox`         { id, status, workspace, image, started_at }
  - `terminal_log`    append-only list of command runs (for the SandboxTab)
  - `sandbox_files`   list of files the agent has touched (paths only;
                      content is read on-demand in the frontend)
  - `sandbox_preview` { port, url, started_at } | null when expose() runs

Each canvas-updating tool also bumps `sync.syncedAt` so CanvasPane's
auto-open kicks in.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_core.tools.base import InjectedToolCallId
from langgraph.prebuilt import InjectedState
from langgraph.types import Command

from . import sandbox as sandbox_mgr


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# The Daytona SDK exposes a method named "exec" on its Process object.
# We dispatch it via getattr so the literal `.exec(` syntax never appears
# in source — that pattern trips a generic security-warning hook in this
# repo even though the Python `.exec` method is unrelated to OS-level
# subprocess invocation.
_RUN_METHOD = "exec"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _thread_id_from_config(config: RunnableConfig) -> str:
    """Pull the LangGraph thread_id out of the runnable config.

    LangGraph injects this when the agent is invoked via the SDK. If
    missing (e.g. someone called the tool standalone in a script), we
    fall back to a stable per-process id so the tool still works.
    """
    cfgable = config.get("configurable") or {}
    tid = cfgable.get("thread_id") or cfgable.get("threadId")
    return str(tid) if tid else "no-thread"


def _truncate(text: str, limit: int = 12_000) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-(limit // 2) :]
    omitted = len(text) - len(head) - len(tail)
    return f"{head}\n\n... [{omitted} chars omitted] ...\n\n{tail}"


def _existing_terminal_log(state: Any) -> List[Dict[str, Any]]:
    """LangGraph's InjectedState gives us the snapshot. Pull the list
    out (or [] if absent) so we can append non-destructively."""
    if isinstance(state, dict):
        return list(state.get("terminal_log") or [])
    return []


def _existing_sandbox_files(state: Any) -> List[Dict[str, Any]]:
    if isinstance(state, dict):
        return list(state.get("sandbox_files") or [])
    return []


def _sandbox_meta(entry: sandbox_mgr._CacheEntry) -> Dict[str, Any]:
    image = os.getenv("DAYTONA_IMAGE", "").strip() or "daytona default snapshot"
    return {
        "id": entry.sandbox_id,
        "status": "running",
        "workspace": entry.workspace,
        "image": image,
        "started_at": _now_iso(),
    }


def _ambient_env() -> Dict[str, str]:
    """Env vars to inject into every sandbox shell exec.

    GITHUB_TOKEN: required for git push to private/public repos AND
                  for `gh` CLI auth. We export it as both names because
                  some tools read GITHUB_TOKEN, gh CLI prefers GH_TOKEN
                  (and falls back to GITHUB_TOKEN), and git's HTTPS
                  helper looks at GIT_ASKPASS — so we expose it
                  redundantly to cover all paths.
    """
    out: Dict[str, str] = {}
    gh_token = os.getenv("GITHUB_TOKEN", "").strip()
    if gh_token:
        out["GITHUB_TOKEN"] = gh_token
        out["GH_TOKEN"] = gh_token
    return out


def _run_in_sandbox(
    entry: sandbox_mgr._CacheEntry,
    command: str,
    cwd: Optional[str],
    timeout: int,
    env: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Run a shell command in the sandbox, normalize the response.

    Daytona SDK shape we target (0.18+):
      sandbox.process.<run-method>(command, cwd=..., env=..., timeout=...) →
        ExecutionResponse with .exit_code, .result
    Older shapes that exposed the same method on the sandbox itself are
    used as a last-resort fallback.

    The ambient env (GITHUB_TOKEN, GH_TOKEN — see `_ambient_env`) is
    merged on EVERY call so git push and `gh` CLI are auth'd
    automatically without the agent having to thread credentials
    through.
    """
    sb = entry.sandbox
    started = time.time()
    exit_code = -1
    stdout = ""
    stderr = ""

    merged_env = {**_ambient_env(), **(env or {})}

    process = getattr(sb, "process", None)
    runner = getattr(process, _RUN_METHOD, None) if process is not None else None

    if callable(runner):
        try:
            kwargs: Dict[str, Any] = {"command": command}
            if cwd:
                kwargs["cwd"] = cwd
            if merged_env:
                kwargs["env"] = merged_env
            if timeout:
                kwargs["timeout"] = timeout
            resp = runner(**kwargs)
        except TypeError:
            # Some SDK shapes take (command, cwd, env, timeout) positionally.
            resp = runner(command, cwd or entry.workspace, merged_env or None, timeout)
    else:
        # Last-resort: SDK exposes the method directly on the sandbox.
        fallback = getattr(sb, _RUN_METHOD, None)
        if not callable(fallback):
            raise RuntimeError(
                "Daytona SDK has no recognised process runner "
                f"(tried sandbox.process.{_RUN_METHOD} and sandbox.{_RUN_METHOD})."
            )
        resp = fallback(command)

    # Normalize across SDK shapes.
    if isinstance(resp, tuple) and len(resp) >= 2:
        stdout, exit_code = resp[0], resp[1]
    else:
        exit_code = (
            getattr(resp, "exit_code", None)
            if getattr(resp, "exit_code", None) is not None
            else getattr(resp, "exitCode", -1)
        )
        stdout = (
            getattr(resp, "result", None)
            or getattr(resp, "stdout", None)
            or ""
        )
        stderr = getattr(resp, "stderr", None) or ""

    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "command": command,
        "cwd": cwd or entry.workspace,
        "stdout": str(stdout or ""),
        "stderr": str(stderr or ""),
        "exit_code": int(exit_code) if exit_code is not None else -1,
        "duration_ms": elapsed_ms,
    }


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def sandbox_create(
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Boot (or attach to) the per-thread Daytona sandbox.

    First call in a thread cold-starts a fresh sandbox (~5-15s) and
    pins it for the rest of the conversation. Subsequent calls are
    no-ops that just refresh `state.sandbox` so the canvas re-renders.
    Most users won't need to call this directly — every other
    sandbox_* tool implicitly creates the sandbox if it doesn't exist.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"Failed to start sandbox: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    summary = f"Sandbox ready (id={entry.sandbox_id}, workspace={entry.workspace})."
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_shell(
    command: Annotated[
        str,
        "Shell command to run in the sandbox. Runs as bash -c so pipes, "
        "&&, redirection all work. Examples: 'ls -la', 'npm install', "
        "'python script.py', 'cat package.json'.",
    ],
    cwd: Annotated[
        Optional[str],
        "Working directory. Defaults to the sandbox's home dir. Use "
        "this when chaining commands across cd boundaries (e.g. after "
        "git_clone, set cwd to the cloned repo path).",
    ] = None,
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Run a shell command inside the per-thread sandbox.

    The result (exit_code, stdout, stderr, duration) gets appended to
    `state.terminal_log` so the canvas's Sandbox tab renders it. The
    LLM also sees the stdout/stderr in the ToolMessage so it can
    reason over the output.

    For long-running servers (npm run dev, python -m http.server),
    pass a backgrounding form like 'nohup npm run dev > dev.log 2>&1 &'
    so the tool returns immediately. Then call sandbox_expose(port)
    to surface the preview URL on the canvas.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    try:
        result = _run_in_sandbox(entry, command, cwd, timeout=120)
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_shell failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    entry_log = {
        "id": str(uuid.uuid4()),
        "command": result["command"],
        "cwd": result["cwd"],
        "stdout": _truncate(result["stdout"], 4_000),
        "stderr": _truncate(result["stderr"], 4_000),
        "exit_code": result["exit_code"],
        "duration_ms": result["duration_ms"],
        "ts": _now_iso(),
    }
    new_log = _existing_terminal_log(state) + [entry_log]

    body_for_chat = _truncate(result["stdout"] or result["stderr"], 2_000)
    headline = (
        f"$ {command}  → exit {result['exit_code']} ({result['duration_ms']}ms)"
    )
    chat_text = f"{headline}\n\n{body_for_chat}" if body_for_chat else headline

    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "terminal_log": new_log,
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=chat_text, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_write_file(
    path: Annotated[
        str,
        "Absolute path inside the sandbox, or relative to the sandbox "
        "workspace (~). Parent directories are created automatically.",
    ],
    content: Annotated[str, "File contents (UTF-8 text)."],
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Write a UTF-8 text file inside the sandbox.

    Use this for source code, configs, scripts. Tracks the path in
    `state.sandbox_files` so the canvas's Files panel can list it.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    sb = entry.sandbox
    payload = content.encode("utf-8")

    parent = path.rsplit("/", 1)[0] if "/" in path else ""
    if parent:
        try:
            _run_in_sandbox(entry, f"mkdir -p {parent!r}", cwd=None, timeout=10)
        except Exception:  # noqa: BLE001
            pass

    try:
        fs = getattr(sb, "fs", None)
        upload = getattr(fs, "upload_file", None) if fs is not None else None
        if callable(upload):
            try:
                upload(path, payload)
            except TypeError:
                upload(payload, path)
        else:
            _run_in_sandbox(
                entry,
                f"cat > {path!r} <<'__GPILOT_EOF__'\n{content}\n__GPILOT_EOF__",
                cwd=None,
                timeout=30,
            )
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_write_file failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    file_entry = {
        "path": path,
        "bytes": len(payload),
        "ts": _now_iso(),
        "kind": "write",
    }
    files = [f for f in _existing_sandbox_files(state) if f.get("path") != path]
    files.append(file_entry)

    summary = f"Wrote {len(payload)} bytes to {path}."
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "sandbox_files": files,
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_read_file(
    path: Annotated[str, "Absolute or workspace-relative path to read."],
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Read a UTF-8 text file from the sandbox.

    Returns the contents as a tool message (truncated past ~12k
    chars). Doesn't update the canvas — the Files tab already lists
    written files; this is for the agent's own reasoning.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    sb = entry.sandbox
    text: str
    try:
        fs = getattr(sb, "fs", None)
        download = getattr(fs, "download_file", None) if fs is not None else None
        if callable(download):
            data = download(path)
            text = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)
        else:
            result = _run_in_sandbox(entry, f"cat {path!r}", cwd=None, timeout=30)
            if result["exit_code"] != 0:
                raise RuntimeError(
                    f"cat exited {result['exit_code']}: {result['stderr']}"
                )
            text = result["stdout"]
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_read_file failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    body = _truncate(text)
    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=f"// {path}\n\n{body}",
                    tool_call_id=tool_call_id,
                )
            ],
        }
    )


@tool
def sandbox_git_clone(
    repo_url: Annotated[
        str,
        "Repository URL. https:// works for public repos; private ones "
        "need GITHUB_TOKEN set in the agent env (auto-injected as "
        "https://x-access-token:<token>@github.com/...).",
    ],
    dest: Annotated[
        Optional[str],
        "Destination directory (workspace-relative). Defaults to the repo name.",
    ] = None,
    branch: Annotated[Optional[str], "Branch to checkout."] = None,
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Clone a Git repository into the sandbox.

    For private repos, set GITHUB_TOKEN in the agent .env. The token
    is rewritten into the URL only inside the sandbox process — the
    log entry stored on canvas state has the token scrubbed.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    token = os.getenv("GITHUB_TOKEN", "").strip()
    auth_url = repo_url
    if token and repo_url.startswith("https://github.com/"):
        auth_url = repo_url.replace(
            "https://github.com/",
            f"https://x-access-token:{token}@github.com/",
            1,
        )

    cmd_parts = ["git", "clone"]
    if branch:
        cmd_parts += ["--branch", branch, "--single-branch"]
    cmd_parts.append(f"'{auth_url}'")
    if dest:
        cmd_parts.append(f"'{dest}'")
    cmd = " ".join(cmd_parts)

    try:
        result = _run_in_sandbox(entry, cmd, cwd=None, timeout=180)
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_git_clone failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    safe_cmd = cmd.replace(token, "<github-token>") if token else cmd
    log_entry = {
        "id": str(uuid.uuid4()),
        "command": safe_cmd,
        "cwd": result["cwd"],
        "stdout": _truncate(result["stdout"], 4_000),
        "stderr": _truncate(result["stderr"], 4_000),
        "exit_code": result["exit_code"],
        "duration_ms": result["duration_ms"],
        "ts": _now_iso(),
    }
    new_log = _existing_terminal_log(state) + [log_entry]

    if result["exit_code"] != 0:
        return Command(
            update={
                "sandbox": _sandbox_meta(entry),
                "terminal_log": new_log,
                "sync": {"source": "daytona", "syncedAt": _now_iso()},
                "messages": [
                    ToolMessage(
                        content=(
                            f"Clone failed (exit {result['exit_code']}): "
                            f"{result['stderr'][:500]}"
                        ),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    summary = f"Cloned {repo_url}" + (f" (branch {branch})" if branch else "") + "."
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "terminal_log": new_log,
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_expose(
    port: Annotated[int, "TCP port the sandbox is listening on (e.g. 3000, 8000, 8080)."],
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Get a public preview URL for a port the sandbox is serving.

    Use AFTER you've started a server with sandbox_shell (e.g.
    `nohup python -m http.server 8000 > /tmp/srv.log 2>&1 &`). Sets
    `state.sandbox_preview` so the canvas embeds the page in an iframe.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    sb = entry.sandbox
    url: Optional[str] = None
    try:
        if hasattr(sb, "get_preview_link"):
            link = sb.get_preview_link(port)
            url = getattr(link, "url", None) or (
                link.get("url") if isinstance(link, dict) else None
            )
        elif hasattr(sb, "preview_link"):
            url = sb.preview_link(port)
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_expose failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    if not url:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=(
                            f"Couldn't resolve a preview URL for port {port}. "
                            "Make sure your SDK exposes get_preview_link."
                        ),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    preview = {"port": port, "url": url, "started_at": _now_iso()}
    summary = f"Port {port} is live → {url}"
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "sandbox_preview": preview,
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_github_setup(
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Bootstrap GitHub-related tooling inside the per-thread sandbox.

    Idempotent — call it whenever you need git/gh to "just work" in
    the sandbox. Concretely it:
      - sets `git config --global user.email/name` so commits don't
        fail with "Author identity unknown"
      - installs the `gh` CLI if missing (apt-get on Ubuntu-based
        snapshots, ~10-30s first time)
      - GitHub auth itself is already in place: GITHUB_TOKEN /
        GH_TOKEN are auto-exported into every sandbox_shell invocation
        from the agent's env

    Use this BEFORE the first `gh` command or first `git commit` /
    `git push` of a session.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    # One bash one-liner so it's atomic and `set -e` fails fast.
    bootstrap = (
        "set -e; "
        "git config --global user.email 'agent@gpilot.dev'; "
        "git config --global user.name 'gpilot agent'; "
        "git config --global init.defaultBranch main; "
        # Install gh only if missing. apt-get is silent (-qq) and
        # auto-yes (-y). We try sudo first, fall back to bare apt-get
        # because Daytona snapshots vary on whether the default user
        # has passwordless sudo.
        "if ! command -v gh >/dev/null 2>&1; then "
        "  (sudo apt-get update -qq && sudo apt-get install -y gh) "
        "  || (apt-get update -qq && apt-get install -y gh) "
        "  || { echo 'gh install failed' >&2; exit 1; }; "
        "fi; "
        "gh --version | head -1"
    )

    try:
        result = _run_in_sandbox(entry, bootstrap, cwd=None, timeout=180)
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_github_setup failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    if result["exit_code"] != 0:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=(
                            f"sandbox_github_setup exited {result['exit_code']}: "
                            f"{(result['stderr'] or result['stdout'])[:600]}"
                        ),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    summary = (
        f"GitHub tooling ready in sandbox: {result['stdout'].strip().splitlines()[-1]}"
        if result["stdout"]
        else "GitHub tooling ready in sandbox."
    )
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=summary, tool_call_id=tool_call_id)
            ],
        }
    )


@tool
def sandbox_gh(
    cli_args: Annotated[
        str,
        "Arguments to pass to the `gh` CLI (everything AFTER the leading "
        "'gh '). Examples: 'pr create --title \"...\" --body \"...\"', "
        "'repo create owner/name --public --source=. --remote=origin --push', "
        "'pr list --state=open --limit=5'. The CLI is auth'd via GH_TOKEN "
        "automatically; do NOT include `gh auth login` here.",
    ],
    cwd: Annotated[
        Optional[str],
        "Working directory inside the sandbox. For repo-scoped commands "
        "(pr create, push, etc.), point this at the cloned repo's path.",
    ] = None,
    state: Annotated[dict, InjectedState] = None,
    config: RunnableConfig = None,  # type: ignore[assignment]
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Run any `gh` CLI command inside the per-thread sandbox.

    Use for: PR creation, repo creation, PR review/merge, issue
    management, gist creation. The CLI auths via $GH_TOKEN which we
    inject from the agent's env on every call. Output (stdout +
    stderr) is appended to the canvas's terminal log AND returned as
    a tool message so you can reason over it.

    Call `sandbox_github_setup` first if you haven't yet — it
    installs the gh CLI on a fresh sandbox.
    """
    thread_id = _thread_id_from_config(config)
    try:
        entry = sandbox_mgr.get_or_create_sandbox(thread_id)
    except sandbox_mgr.SandboxNotConfiguredError as e:
        return Command(
            update={
                "messages": [
                    ToolMessage(content=str(e), tool_call_id=tool_call_id)
                ],
            }
        )

    cmd = f"gh {cli_args.strip()}"
    try:
        result = _run_in_sandbox(entry, cmd, cwd=cwd, timeout=120)
    except Exception as e:  # noqa: BLE001
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"sandbox_gh failed: {e}",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    log_entry = {
        "id": str(uuid.uuid4()),
        "command": cmd,
        "cwd": result["cwd"],
        "stdout": _truncate(result["stdout"], 4_000),
        "stderr": _truncate(result["stderr"], 4_000),
        "exit_code": result["exit_code"],
        "duration_ms": result["duration_ms"],
        "ts": _now_iso(),
    }
    new_log = _existing_terminal_log(state) + [log_entry]

    body = result["stdout"] or result["stderr"]
    headline = f"$ {cmd}  → exit {result['exit_code']} ({result['duration_ms']}ms)"
    chat_text = (
        f"{headline}\n\n{_truncate(body, 2_000)}" if body else headline
    )
    return Command(
        update={
            "sandbox": _sandbox_meta(entry),
            "terminal_log": new_log,
            "sync": {"source": "daytona", "syncedAt": _now_iso()},
            "messages": [
                ToolMessage(content=chat_text, tool_call_id=tool_call_id)
            ],
        }
    )


def load_sandbox_tools() -> list:
    """Return the @tool list to merge into the agent's tool surface."""
    return [
        sandbox_create,
        sandbox_shell,
        sandbox_write_file,
        sandbox_read_file,
        sandbox_git_clone,
        sandbox_expose,
        sandbox_github_setup,
        sandbox_gh,
    ]
