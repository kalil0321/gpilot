import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { Client as LangGraphClient } from "@langchain/langgraph-sdk";
import { Daytona, type DaytonaConfig } from "@daytonaio/sdk";
import { Hono } from "hono";

const intelligence = new CopilotKitIntelligence({
  apiKey:
    process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00",
  apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4203",
  wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4403",
});

// LangGraph 0.6+ rejects requests that set both `config.configurable` and
// `context` ("Cannot specify both configurable and context. Prefer setting
// context alone.").
//
// The AG-UI LangGraph adapter (@ag-ui/langgraph) builds the request payload
// as: `{ ..., config: w, context: { ...input.context, ...w.configurable } }`.
// It mirrors `forwardedProps.config.configurable` into BOTH places, which
// trips the server-side guard.
//
// We don't want to fork the adapter for one line, so we wrap the underlying
// langgraph-sdk client and strip `configurable` from `config` right before
// the wire send. The `context` half already carries the same values, and
// the agent middleware reads them from `request.runtime.context` (see
// `apps/agent/src/model_dispatch.py`).
const langGraphClient = new LangGraphClient({
  apiUrl: process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  apiKey: process.env.LANGSMITH_API_KEY ?? "",
});

type StreamPayload = { config?: { configurable?: unknown } } & Record<string, unknown>;
const originalRunsStream = langGraphClient.runs.stream.bind(langGraphClient.runs);
langGraphClient.runs.stream = ((
  threadId: string | null,
  assistantId: string,
  payload?: StreamPayload,
) => {
  if (
    payload?.context &&
    payload.config &&
    typeof payload.config === "object" &&
    "configurable" in payload.config &&
    payload.config.configurable
  ) {
    const { configurable: _drop, ...restConfig } = payload.config as {
      configurable?: unknown;
    };
    payload = { ...payload, config: restConfig };
  }
  return originalRunsStream(threadId as string, assistantId, payload as never);
}) as typeof langGraphClient.runs.stream;

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  graphId: "default",
  langsmithApiKey: process.env.LANGSMITH_API_KEY ?? "",
  client: langGraphClient,
  // The deep-agent middleware chain (todo / filesystem / subagents /
  // summarization) eats ~6-8 graph steps per real model→tools round
  // trip, so the effective ceiling is recursion_limit / 7. We bumped
  // from 60 → 150 because gpilot now ships 12 tools + multi-step
  // flows (gcloud + bigquery + render_ui, or sandbox setup → clone →
  // edit → commit → push → gh pr create). 60 was hitting the cap on
  // simple "open a PR" prompts; 150 gives ~21 real turns of headroom.
  assistantConfig: {
    recursion_limit: Number(process.env.LANGGRAPH_RECURSION_LIMIT ?? 150),
  },
});

// `createCopilotEndpoint` returns a Hono instance with `.basePath(...)`
// already applied AND a `.all('*')` catch-all already registered. Any
// route we'd add to that instance is (a) double-prefixed by the
// basePath and (b) shadowed by the catch-all that runs first. So we
// build a parent Hono, mount our custom routes on it FIRST, then
// merge the CopilotKit endpoint's routes.
const copilotEndpoint = createCopilotEndpoint({
  basePath: "/api/copilotkit",
  runtime: new CopilotRuntime({
    intelligence,
    identifyUser: () => ({ id: "default", name: "Hackathon User" }),
    licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
    agents: { default: agent },
    openGenerativeUI: true,
    a2ui: { injectA2UITool: false },
    mcpApps: {
      servers: [
        {
          type: "http",
          url: process.env.MCP_SERVER_URL || "http://localhost:3001/mcp",
          serverId: "manufact_local",
        },
      ],
    },
  }),
});

const app = new Hono();

// ---------------------------------------------------------------------------
// Custom route: direct LangGraph thread-state proxy.
//
// CopilotKit Intelligence Platform's `/connect` endpoint (which is what
// the frontend's `connectAgent` call ends up hitting in INTELLIGENCE
// runtime mode) is designed to JOIN an active WebSocket session, not
// REPLAY a completed run's history. Concretely, when a thread's run
// has ended and its WS session has aged out, the endpoint returns
// HTTP 204 No Content. The AG-UI client then resolves with `null`
// credentials, switches to `rxjs.EMPTY`, and the frontend sees zero
// events → blank chat on refresh.
//
// This is by design on the Intelligence side. To get reliable history
// loading we bypass Intelligence and go straight to LangGraph, which
// stores the full thread state regardless. The frontend hits this
// route as a fallback after `connectAgent` settles with empty
// messages, then populates `agent.state` from the response.
// ---------------------------------------------------------------------------
const langgraphClient = new LangGraphClient({
  apiUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8133",
  apiKey: process.env.LANGSMITH_API_KEY ?? "",
});

app.get("/api/copilotkit/thread-state/:threadId", async (c) => {
  const threadId = c.req.param("threadId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
    return c.json({ error: "Invalid thread id" }, 400);
  }
  try {
    const state = await langgraphClient.threads.getState(threadId);
    return c.json(state);
  } catch (err: unknown) {
    const status =
      (err as { status?: number; response?: { status?: number } })?.status ??
      (err as { response?: { status?: number } })?.response?.status ??
      500;
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, status === 404 ? 404 : 500);
  }
});

// ---------------------------------------------------------------------------
// Daytona sandbox file proxy.
//
// The agent owns the per-thread sandbox via the Python Daytona SDK. The
// frontend's sandbox-explorer node needs to LIST and READ files from
// that same live sandbox to support click-to-inspect. Rather than
// piping the request through the agent (which would have to round-trip
// through LangGraph), we reach Daytona directly with our own TS SDK
// client — it just needs the sandbox id (which the frontend already
// reads from agent.state.sandbox.id) and the API key (server-side env).
//
// `cat` truncates to MAX_CAT_BYTES so a careless click on a giant log
// file doesn't ship megabytes to the browser. The truncation is
// signaled in the JSON envelope (`truncated: true, totalBytes: N`).
// ---------------------------------------------------------------------------
const MAX_CAT_BYTES = 200 * 1024; // 200 KB

let daytonaClient: Daytona | null = null;
function getDaytona(): Daytona | null {
  if (daytonaClient) return daytonaClient;
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = process.env.DAYTONA_API_URL?.trim();
  const config: DaytonaConfig = apiUrl ? { apiKey, apiUrl } : { apiKey };
  daytonaClient = new Daytona(config);
  return daytonaClient;
}

function sandboxIdLooksValid(sid: string | undefined): sid is string {
  // Daytona ids are uuids in practice; we just want to reject obvious
  // garbage / empty without overcommitting to a specific format.
  return typeof sid === "string" && sid.length > 0 && sid.length < 200;
}

app.get("/api/sandbox/ls", async (c) => {
  const sid = c.req.query("sid");
  const path = c.req.query("path") ?? ".";
  if (!sandboxIdLooksValid(sid)) {
    return c.json({ error: "Missing or invalid sid" }, 400);
  }
  const daytona = getDaytona();
  if (!daytona) {
    return c.json(
      { error: "DAYTONA_API_KEY is not configured on the server." },
      503,
    );
  }
  try {
    const sandbox = await daytona.get(sid);
    const files = await sandbox.fs.listFiles(path);
    return c.json({
      path,
      entries: files.map((f) => ({
        name: f.name,
        isDir: f.isDir,
        size: f.size,
        modTime: f.modTime,
      })),
    });
  } catch (err: unknown) {
    const status =
      (err as { status?: number; response?: { status?: number } })?.status ??
      (err as { response?: { status?: number } })?.response?.status ??
      500;
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg, path }, status === 404 ? 404 : 500);
  }
});

app.get("/api/sandbox/cat", async (c) => {
  const sid = c.req.query("sid");
  const path = c.req.query("path");
  if (!sandboxIdLooksValid(sid)) {
    return c.json({ error: "Missing or invalid sid" }, 400);
  }
  if (!path) {
    return c.json({ error: "Missing path" }, 400);
  }
  const daytona = getDaytona();
  if (!daytona) {
    return c.json(
      { error: "DAYTONA_API_KEY is not configured on the server." },
      503,
    );
  }
  try {
    const sandbox = await daytona.get(sid);
    const buf: Buffer = await sandbox.fs.downloadFile(path);
    const totalBytes = buf.byteLength;
    const truncated = totalBytes > MAX_CAT_BYTES;
    const body = truncated ? buf.subarray(0, MAX_CAT_BYTES) : buf;
    // Best-effort UTF-8 decode. Binary files come back as garbled
    // text — the frontend renders them in a monospace block anyway,
    // so the user sees they grabbed something non-text and can move
    // on. We mark `binaryHint` when the buffer contains many NULs.
    const text = body.toString("utf-8");
    const nulCount = (text.match(/\0/g) ?? []).length;
    const binaryHint = nulCount > 8;
    return c.json({
      path,
      content: text,
      totalBytes,
      truncated,
      binaryHint,
    });
  } catch (err: unknown) {
    const status =
      (err as { status?: number; response?: { status?: number } })?.status ??
      (err as { response?: { status?: number } })?.response?.status ??
      500;
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg, path }, status === 404 ? 404 : 500);
  }
});

// Rewrite known 5xx error bodies into structured `{ error, hint, command }`
// payloads the UI can render as actionable toasts. Conservative matching —
// we only remap when we can identify the failure from the body, so unknown
// 5xx errors fall through unchanged.
app.use("*", async (c, next) => {
  await next();
  const status = c.res.status;
  if (status < 500 || status > 599) return;
  const cloned = c.res.clone();
  const ctype = cloned.headers.get("content-type") || "";
  if (!ctype.includes("json") && !ctype.includes("text")) return;
  let body: string;
  try {
    body = await cloned.text();
  } catch {
    return;
  }
  const isThreadFkey =
    body.includes("threads_user_id_fkey") ||
    (body.includes("Failed to initialize thread") &&
      body.includes("user_id"));
  if (isThreadFkey) {
    const remapped = {
      error: "Postgres user seed missing",
      hint: "Run `npm run seed` to seed the default user, then retry.",
      command: "npm run seed",
    };
    c.res = new Response(JSON.stringify(remapped), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    return;
  }

  // AgentThreadLockedError: a prior run errored mid-stream and the LangGraph
  // SDK's per-thread lock didn't release. The thread is unrecoverable; the
  // hint tells the user to start a new conversation.
  const isThreadLocked =
    body.includes("AgentThreadLockedError") ||
    /Thread\s+[0-9a-f-]{36}\s+is locked/i.test(body);
  if (isThreadLocked) {
    const remapped = {
      error: "Thread is locked",
      hint:
        "A previous turn errored mid-stream and didn't release the run " +
        "lock. Start a new conversation (sidebar → +) to continue.",
      command: "new-thread",
    };
    c.res = new Response(JSON.stringify(remapped), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    return;
  }
});

// Mount the CopilotKit endpoint LAST so its catch-all only matches
// after our specific routes have had their chance.
app.route("/", copilotEndpoint);

const port = Number(process.env.PORT) || 4000;

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
