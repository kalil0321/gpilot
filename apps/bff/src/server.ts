import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { Client as LangGraphClient } from "@langchain/langgraph-sdk";
import { Hono } from "hono";

const intelligence = new CopilotKitIntelligence({
  apiKey:
    process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00",
  apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4203",
  wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4403",
});

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  graphId: "default",
  langsmithApiKey: process.env.LANGSMITH_API_KEY ?? "",
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
