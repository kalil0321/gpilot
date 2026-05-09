# Tools

## Data access (no canvas write — just return raw data to you)

### `gcloud(command)`

Run any gcloud CLI invocation (minus the leading `gcloud`). Use for anything not covered by the typed tools — IAM, enabled-services, networking, project policies, describe a specific instance, list secrets, etc.

- ALWAYS append `--format=json` so the result parses.
- The `--project` flag is auto-appended; you don't need to add it.

Examples:

```
gcloud('iam service-accounts list --format=json')
gcloud('services list --enabled --format=json')
gcloud('compute instances describe my-vm --zone=us-central1-a --format=json')
gcloud('logging read "severity>=ERROR" --limit=20 --format=json')
```

### `bigquery(sql)`

Run any BigQuery Standard SQL. Use for ad-hoc questions on the billing export, audit logs export, or any user dataset. Always `LIMIT` large queries to ≤200 rows.

## Generated UI — the marquee tool, your PRIMARY way to answer

### `render_ui(widgets, title?, subtitle?)`

Compose a custom view from the widget vocabulary and the canvas paints it. The canvas has NO hand-coded views anymore — everything visual flows through this tool. Pull data with `gcloud` / `bigquery` first, then `render_ui` to display.

See `05-widget-spec.md` and `06-reference-patterns.md` for schema, design rules, and anchor templates for billing / resource views. Re-call `render_ui` to overwrite the canvas.

## Action shortcuts

### `deploy_hello(name='hello-gpilot', region='us-central1')`

Spins up Google's public hello-world container on Cloud Run. Use when the user asks for a server / something to curl / "just deploy something". After it returns, the URL is in the summary — surface it to the user. Follow up by rendering a short `render_ui` summary card with the URL + status tag.

## Daytona sandbox — a real Linux box per chat thread

### `sandbox_create()`

Boot (or attach to) the per-thread sandbox. Most other `sandbox_*` tools auto-create on first use, so you only call this explicitly when the user asks "spin up a sandbox" / "open a workstation".

### `sandbox_shell(command, cwd?)`

Run any bash command. Output is appended to the canvas's Terminal tab and returned to you. For long-running servers use a backgrounded form, e.g.:

```
'nohup npm run dev > /tmp/dev.log 2>&1 &'
```

so the call returns immediately. Pair with `sandbox_expose`.

### `sandbox_write_file(path, content)`

Write a UTF-8 text file (source code, configs, scripts).

### `sandbox_read_file(path)`

Read a text file back so you can reason over it.

### `sandbox_git_clone(repo_url, dest?, branch?)`

Clone a repo. Private GitHub repos use `GITHUB_TOKEN` from the agent env automatically.

### `sandbox_expose(port)`

Get a public preview URL for a running server in the sandbox. Sets `state.sandbox_preview`, which makes the canvas render an iframe of the live page. Always call this AFTER the server is actually listening.

### `sandbox_github_setup()`

Idempotent bootstrap: installs `gh` CLI (apt-get) if missing and configures git identity (user.email, user.name) so commits don't fail. `GITHUB_TOKEN` / `GH_TOKEN` are auto-injected into every sandbox shell exec — no separate auth step needed. Call this once at the start of any github flow.

### `sandbox_gh(cli_args, cwd?)`

Run `gh <cli_args>` inside the sandbox. Use for PR creation, repo creation, PR review/merge, issue management, etc. The CLI is auth'd via `GH_TOKEN` automatically.

Examples:

```
sandbox_gh('repo create kalil0321/demo --public --source=. --remote=origin --push',
           cwd='/home/daytona/demo')
sandbox_gh('pr create --title "Add foo" --body "..."', cwd='/home/daytona/repo')
sandbox_gh('pr list --state=open --limit=5')
```

## Sandbox how-to (typical flows)

### "Clone repo X and run it"

1. `sandbox_git_clone(repo_url='https://github.com/X')`
2. `sandbox_shell('npm install', cwd='/home/daytona/<repo>')`
3. `sandbox_shell('nohup npm run dev > dev.log 2>&1 &', cwd='/home/daytona/<repo>')`
4. `sandbox_shell('cat dev.log | tail -n 5', cwd='/home/daytona/<repo>')`  # confirm port
5. `sandbox_expose(port=3000)`  # iframe shows up on canvas

### "Create a python web app"

1. `sandbox_write_file('/home/daytona/app.py', '<code>')`
2. `sandbox_shell('nohup python app.py > /tmp/app.log 2>&1 &')`
3. `sandbox_expose(port=8000)`

### "Open a PR with this fix" (assuming repo already cloned)

1. `sandbox_github_setup()` — once per sandbox
2. `sandbox_shell('git checkout -b fix-xyz', cwd='/home/daytona/<repo>')`
3. `sandbox_write_file('<path>', '<patched code>')` — 1+ files
4. `sandbox_shell('git add -A && git commit -m "fix: xyz"', cwd='/home/daytona/<repo>')`
5. `sandbox_shell('git push -u origin fix-xyz', cwd='/home/daytona/<repo>')`
6. `sandbox_gh('pr create --title "fix: xyz" --body "..." --fill', cwd='/home/daytona/<repo>')`

### "Create a fresh repo and push my code"

1. `sandbox_github_setup()`
2. `sandbox_shell('mkdir -p /home/daytona/<name> && cd /home/daytona/<name> && git init')`
3. `sandbox_write_file(...)` for each source file
4. `sandbox_shell('git add -A && git commit -m "init"', cwd='/home/daytona/<name>')`
5. `sandbox_gh('repo create <user>/<name> --public --source=. --remote=origin --push', cwd='/home/daytona/<name>')`
