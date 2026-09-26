# Zeno AI

**A self-hosted AI agent harness. Bring your own providers, models, tools, skills, plugins, and MCP servers into one unified environment — one AI that can both talk and act.**

Zeno is a full-stack product: a vanilla-JS frontend served by a Node.js backend with real persistence, a multi-provider AI gateway, and a **capability harness** that merges every source of agent power — built-in tools, MCP servers, HTTP plugins, plugin packs, skills, and memory — into one per-turn catalog the model orchestrates. No mocked responses, no simulated agents.

---

## Highlights

- **A real agent harness** — capabilities are data, not hardcoded behavior. Adding a skill is dropping a markdown file into `skills/`; adding a tool pack is a plugin; adding an MCP server or HTTP plugin is a connection. The harness composes all of them per user, per turn, and the model chooses what to call. Multi-step tool use happens inline with live activity cards.
- **The intelligence layer (Jev + routing + cost + verification)** — every turn first passes a fast structured decision round: *direct chat or agent? which model tier? how much verification? what risk?* The default decision maker is a deterministic in-process classifier (microseconds, zero tokens); you can point it at your own Jev endpoint or a small OpenAI-compatible classifier model instead — on any failure it degrades back to the built-in one. A cost-aware ModelRouter routes auxiliary work (planning, history summaries, verification — and optionally the main agent loop) to the *minimum-cost tier that can do the job*, a CostGovernor tracks estimated USD spend per model call and enforces per-request/day/month budgets, non-sensitive tool calls run concurrently while sensitive ones stay human-paced, research requests are decomposed into parallel sub-queries with follow-up page reads, and complex or high-risk answers pass a VerificationEngine (deterministic checks → grader model → one bounded regeneration at a higher tier) before they're finalized. All of it lives in **Settings → Intelligence** and **Settings → Cost & Usage** — the chat surface stays simple.
- **One unified AI** — there is no separate "agent page". A single conversation surface where the model itself decides whether to answer directly or act: search the web, read pages, read/write workspace files, run code, execute terminal commands, or call your own plugins and remote MCP servers. Skills matching the request are loaded automatically.
- **Permission modes, in the composer** — *Ask Before Change*, *Workspace Edit*, and *Full Access* are real execution gates, not UI decoration: the active mode is re-read on every turn and decides which sensitive actions pause for your approval. Ask mode pauses terminal, code execution, arbitrary HTTP, connections, and local-computer access; Workspace Edit additionally auto-runs workspace file writes/edits; Full Access runs everything, including your local computer.
- **Plan Mode (Plan Before Editing)** — toggle it in the composer and Zeno first analyzes the request and streams an actionable plan (understanding + numbered steps) before anything runs. Under Ask Before Change the plan itself waits for your Approve/Decline inline; the approved plan becomes the model's instructions for the turn and is persisted so reloads replay it.
- **Any provider, any model** — OpenAI, Anthropic, Google Gemini, Ollama (local), and *any* OpenAI-compatible endpoint (OpenRouter, Groq, DeepSeek, Together, vLLM, LM Studio…). Add multiple providers with your own API keys, register models with context windows and capabilities, switch models per conversation.
- **Skills** — reusable instruction packs (deep research, code review, data analysis, task planning ship built-in). Trigger keywords decide which skills load for a request; view, duplicate, or author your own in Settings → Tools & capabilities.
- **Plugins** — capability bundles: tools + skills + guidance. Built-in packs (web, memory, workspace, compute, research, engineering, planning — plus *local computer* when the bridge is enabled) demonstrate the shape; install your own declarative packs with fixed endpoints, JSON-Schema arguments, and encrypted secrets.
- **Bring your own connections** — MCP servers (streamable HTTP) and HTTP plugins are first-class. Register an endpoint, discover its tools, and the model can call them mid-conversation. Credentials are encrypted at rest; every connector call is approval-gated and restricted to public Internet hosts.
- **Human approvals, inline** — sensitive actions pause with `Allow once / Allow for this task / Deny` directly in the conversation, with human-readable summaries (e.g. "Read file C:\you\Desktop\notes.md on your computer").
- **Local computer bridge** — enable it and the agent can read, list, write, edit, and delete files *outside* the workspace on the machine running Zeno (Desktop, Documents, …), strictly inside roots you allow-list. Locally that's your computer; deployed, it's the server environment — same tools, same permission modes, same approvals, full audit trail.
- **Intelligent memory** — a selective-storage pipeline, not a dump: writes are deduplicated (exact repeats reinforce the existing memory), near-duplicates supersede outdated ones (conflict handling), and importance is scored at write time. Retrieval blends semantic similarity with recency (exponential decay), importance, and usage reinforcement; consolidation merges near-duplicate traces, strengthens frequently-recalled ones, and expires weak stale memories. Semantic facts, preferences, and episodic context are typed separately; extraction after conversations produces typed, importance-scored candidates and skips trivial chat.
- **An agent-native chat surface** — an animated Thinking state (expandable, with visible reasoning streamed live), tool cards that animate through states (Reading → Read, Writing → Written, Editing → Edited…) with per-tool verbs and durations, plan cards with inline approval, and a VS Code-style file preview panel — file-type icon, path bar, line numbers, syntax highlighting — one click away from any file activity card. No chain-of-thought is exposed; the expandable area shows supported visible reasoning only.
- **Security first** — AES-256-GCM encrypted provider/connector/plugin secrets at rest, scrypt password hashing, opaque session tokens, per-user sandboxed workspaces with path-escape protection, SSRF guards on all agent-driven web tools, allow-listed roots for local filesystem access, security headers + CSP, rate limiting, and a full audit log.
- **Purple-first design system** — layered deep-space surfaces with a violet gradient accent, glass composer, dark/light themes, compact density, and motion tuned with spring/ease tokens.

## Architecture

```
Zeno AI
├── frontend/               Vanilla ES modules, zero framework — a client of the
│   │                       agent system, never the agent itself
│   ├── index.html
│   ├── css/                Design tokens (purple accent, dark + light) + component/view styles
│   ├── js/
│   │   ├── app.js          Shell, routing, shortcuts, data loading
│   │   ├── api.js          REST + SSE client
│   │   ├── state.js        Store + selectors
│   │   ├── filetypes.js    Extension → icon/color/language map
│   │   ├── ui.js           DOM builder, toasts, modals, menus
│   │   ├── markdown.js     marked + DOMPurify + highlight.js pipeline
│   │   ├── components/     Composer (model · permission · plan chips), message,
│   │   │                   activity/tool-state cards, thinking, plan cards,
│   │   │                   VS Code-style file preview, sidebar, palette
│   │   └── views/          Chat, Settings control center (general · permissions ·
│   │                       tools · connections · providers · environments ·
│   │                       workspaces · appearance · security · system),
│   │                       Projects, Memory, Files
│   └── vendor/             Vendored libs + self-hosted fonts (works offline)
│
├── skills/                 Built-in skills: markdown + frontmatter. Drop in a
│                           file, restart, done — no code change.
│
├── local-agent/            THE LOCAL DAEMON: pairs with the server over an
│                           outbound WebSocket and exposes your machine's
│                           filesystem (optionally shell) inside roots you set.
│
└── backend/                Node.js (≥22.5), ES modules
    ├── server.js           Composition root: wiring, static serving, WS attach
    ├── core/               Config, logger, errors, crypto, validation, rate limit, event bus
    ├── auth/               Register/login, sessions (scrypt + hashed tokens)
    ├── providers/          AI Gateway + adapters: openai-compatible, anthropic, gemini, ollama
    ├── decision/           THE DECISION LAYER (System One): JevDecisionEngine —
    │                       per-turn routing object (chat vs agent, task type,
    │                       complexity, tier, risk, verification), deterministic
    │                       heuristic classifier, remote Jev provider (custom
    │                       JSON endpoint or OpenAI-compatible model), decision
    │                       cache, failure taxonomy + retry plans, learning
    │                       execution-policy stats (bounded, resettable)
    ├── routing/            Cost-aware ModelRouter (tiers: local/fast/balanced/
    │                       reasoning/premium; per-purpose selection + escalation)
    │                       and CostGovernor (usage ledger, estimates, budgets)
    ├── agent/              THE AGENT RUNTIME (surface-independent)
    │   ├── orchestrator.js One per-turn pipeline for chat AND background runs:
    │   │                   routing → catalog → context → [research] → [plan]
    │   │                   → loop (retries, cost gates, parallel dispatch)
    │   │                   → verification → events
    │   ├── verification.js Independent output verification (deterministic
    │   │                   checks → grader model → bounded regeneration)
    │   ├── retry.js        Failure classification + backoff with jitter
    │   ├── events.js       Typed event model + chat-SSE compatibility mapping
    │   └── context.js      Context engine: sectioned prompts, budgets, history
    │                       compaction
    ├── capabilities/
    │   └── executor.js     The single execution pipeline: resolve → policy →
    │                       approval → execute → observe → post-process
    ├── policy/             Permission/policy ENGINE (modes + per-user rules)
    ├── harness/            Capability layer: registry merge, turn planning,
    │                       skills (progressive loading), plugins (manifests v2
    │                       with hooks), built-in packs
    ├── agents/
    │   ├── runtime.js      Background adapter over the orchestrator (durable runs)
    │   └── approvals.js    Shared human-approval gate
    ├── execution/          Execution Runtime: workspace · docker sandbox ·
    │                       local-agent environments behind one interface
    ├── realtime/           WebSocket gateway (/api/agent-ws) + online-agent
    │                       registry for paired local agents
    ├── connectors/         User-owned HTTP plugins + remote MCP (streamable
    │                       HTTP, discovery cached per connector)
    ├── tools/              Core tool registry + web_search, browser_read,
    │                       http_request, file_read/list/write/edit/delete,
    │                       terminal, code_exec, memory_search/write, skill_load,
    │                       local_* (daemon-first, server-bridge fallback)
    ├── services/           Memory (hybrid semantic search behind a provider
    │                       interface), PDF text extraction
    ├── database/           PostgreSQL (DATABASE_URL) or embedded SQLite — same schema/repos
    ├── workers/            Durable DB-backed job queue + processors
    └── api/                REST routes: auth, providers, harness, connectors,
                            chat/stream, runs (event log + SSE), control
                            (permissions · environments · security), projects,
                            files, memory, settings, decision (preview · stats),
                            cost (summary)
```

**Data stores:** PostgreSQL (with pgvector available) when `DATABASE_URL` is set; otherwise an embedded SQLite database under `./data` — zero-config, identical schema. Uploads live on the filesystem (`data/files`), user agent workspaces under `data/workspaces/<userId>`. Redis is optional for queue coordination; the DB-backed queue is the default and survives restarts.

**Execution isolation:** terminal/code tools route to a Docker sandbox service when `ZENO_SANDBOX_URL` is configured (throwaway containers, no network, CPU/memory caps). Without it they run as restricted child processes inside the per-user workspace — always behind the policy engine's decision.

**One event log:** every chat turn and background run is a persisted run row with a typed event stream (`agent.started`, `plan.created`, `permission.requested`, `tool.started/completed`, `agent.completed`, …). The chat UI renders that stream; the Runs SSE endpoint replays it by sequence. The backend owns execution state — the frontend is a renderer.

## Quick start

```bash
npm install
npm start            # → http://127.0.0.1:3000
```

Create an account, then **Settings → Providers & models → Add provider**. Point it at OpenAI, Anthropic, Gemini, a local Ollama, or any OpenAI-compatible URL and supply your own API key. Register a model (the provider's model list can be fetched automatically), set it as default, and start chatting.

To give the agent new abilities, open **Settings**:

- **Tools & capabilities** — see and toggle every capability the harness offers; author skills; install plugins; tune orchestration.
- **Connections** — add an HTTP plugin or a remote MCP server.

### The harness

Everything the agent can do flows through one capability layer (`backend/harness/`):

| Source | Extends by | Configured in |
| --- | --- | --- |
| Core tools | `tools/registry.js` | code (shipped) |
| Skills | a markdown file in `skills/` | disk, or Settings → Tools |
| Plugin packs | `backend/harness/builtin-plugins.js` | code (shipped) |
| Local computer bridge | `ZENO_LOCAL_BRIDGE=1` + `ZENO_LOCAL_ROOTS` | server env |
| User plugins | a JSON manifest (tools with fixed endpoints) | Settings → Tools → Plugins |
| MCP servers / HTTP plugins | a connector row | Settings → Connections |
| Providers / models | a provider row + your API key | Settings → Providers & models |

Per turn, the **agent orchestrator** (`backend/agent/orchestrator.js`) runs one pipeline shared by chat and background runs: it routes the request through the **decision layer**, merges the user's enabled capabilities into one catalog, matches skills by trigger keywords (progressively — the prompt carries a roster, and the model pulls full instructions via `skill_load`), retrieves relevant memories (contextual recall, not a dump), assembles the system prompt from prioritized sections under a budget (long histories are model-summarized and cached), and then lets the model act. Every capability call — built-in, MCP, HTTP plugin, or local — flows through the **capability executor** (`backend/capabilities/executor.js`): resolve → policy check → approval if required → execute → observe → post-process. Orchestration is tunable in Settings → Tools → Orchestration (auto-skill loading, plugin/connection tools on/off, per-tool switches, and a live "what would load for this request?" preview).

### The intelligence layer (Jev, routing, cost, verification)

The orchestrator never sends a request straight to the most expensive model. Each turn runs one batched **decision round** (`backend/decision/`) that returns a structured routing object — `taskType`, `complexity`, `executionMode`, `modelTier`, `risk`, `verification`, `confidence` — and the pipeline follows it:

1. **Direct chat vs agent.** Clearly self-contained requests (greetings, explanations, rewriting) run with no tool catalog at all — no wasted tokens, no needless tool calls. Ambiguous requests fail *open* to agentic, and conversations already mid-task are never downgraded.
2. **Cost-aware model routing.** The ModelRouter (`backend/routing/model-router.js`) groups registered models into tiers (`local / fast / balanced / reasoning / premium` — explicit per-model override, provider kind, or model-id heuristics) and picks the minimum-cost tier per purpose: planning and history compaction on the *fast* tier, the main loop on the conversation's model (or the decision's tier in "full" routing mode), verification on *balanced*. Escalation is available when verification fails.
3. **Cost governance.** Every model call lands in a usage ledger with an estimated USD cost (your per-model pricing → a built-in approximate table → $0 for local providers). Optional per-request/day/month budgets either downgrade the call to a cheaper tier or block it — configured in **Settings → Cost & Usage** alongside live spend summaries.
4. **Parallel tool dispatch.** Non-sensitive calls in a round execute concurrently (bounded); sensitive ones stay strictly sequential so approvals stay human-paced. Results merge in call order either way.
5. **Research workflow.** Requests classified as research are decomposed into sub-queries, searched in parallel through the real executor, the top sources read in full, and an evidence digest injected for synthesis — real `web_search`/`browser_read` calls, real events, no simulated data.
6. **Verification.** Complex, high-risk, and research answers pass the VerificationEngine (`backend/agent/verification.js`): deterministic checks first, then a grader pass at standard/strict levels; a strict failure triggers ONE bounded regeneration at a higher tier. Findings render as a compact card in the thread; verification never silently rewrites an answer.
7. **Retry intelligence.** Model failures are classified (transient / rate-limit / network / auth / invalid-argument / …) and only the plausibly-recoverable classes retry, with exponential backoff and jitter; permanent errors fail fast.

The default decision maker is a deterministic in-process classifier — microseconds, zero tokens. **Settings → Intelligence** lets you point it at an external Jev service (custom JSON decision API) or any OpenAI-compatible classifier model instead; on timeout or bad output the built-in classifier takes over, so routing never blocks a turn. A bounded, resettable learning policy aggregates per-task-type outcomes and biases starting tiers upward when recent work kept needing escalation — inspectable in Settings, never self-modifying.

### Permission modes + policy engine

| Mode | What it means at execution time |
| --- | --- |
| **Ask Before Change** (default) | Sensitive tools (terminal, code execution, arbitrary HTTP, connections, local-computer access, file deletion) pause for inline approval. In Plan Mode the plan itself is approved first. |
| **Workspace Edit** | Workspace file writes/edits/deletes run automatically. Everything else sensitive still asks. |
| **Full Access** | No approval gates — everything runs, including local-computer tools. Intended for environments you control. |

The mode is the baseline; the **policy engine** (`backend/policy/`) refines it with per-user rules like `fs.write:C:/work/** → allow` or `shell.exec:* → deny` — the most specific rule wins, and a deny beats even Full Access. Rules are managed in **Settings → Permissions** with a live "what would happen?" decision preview. The permission policy (allow/ask/deny) is deliberately separate from the execution runtime (what a process can physically reach). Mode switches, rule changes, and auto-approved sensitive calls all land in the audit log (Settings → Security).

### Local computer access — the bridge architecture

Zeno never assumes a browser can touch your disk. Local access is an explicit, authenticated chain:

```
Zeno Web → Zeno Server → (outbound WebSocket) → Local Agent daemon → your machine
```

- **Web deployments**: pair your computer in **Settings → Environments** (one-time token), then run the daemon from the repo: `node local-agent/agent.js --server <url> --token <token> --roots "C:\Users\you\Desktop;C:\Users\you\Documents"` (add `--allow-shell` for terminal access). The daemon dials out, confines every path to its roots on its side, and can be revoked instantly. The server's policy engine still gates every relayed call — the roots are defense in depth, not the only lock.
- **Local runs**: with `ZENO_LOCAL_BRIDGE=1` + `ZENO_LOCAL_ROOTS` (semicolon-separated on Windows), the server itself may touch those roots directly — same tools (`local_read/list/write/edit/delete`), same permission modes, same approvals.
- When no local agent is paired and the bridge is off, `local_*` capabilities simply don't appear in the agent's catalog.

### Configuration

Copy `.env.example` → `.env` and adjust:

| Variable | Purpose |
| --- | --- |
| `ZENO_SECRET` | **Required in production.** Encrypts stored keys and derives subkeys. |
| `PORT` / `HOST` | Listen address (default `127.0.0.1:3000`). |
| `DATABASE_URL` | PostgreSQL connection string. Unset → embedded SQLite. |
| `REDIS_URL` | Optional queue coordination. Unset → DB-backed queue. |
| `ZENO_SANDBOX_URL` | Docker sandbox for terminal/code tools. Unset → restricted local exec. |
| `ZENO_LOCAL_BRIDGE` / `ZENO_LOCAL_ROOTS` | Server-side local filesystem bridge (roots allow-list) for local runs. |
| `ZENO_CONTEXT_CHAR_BUDGET` | Context engine budget in chars (default 96k; auto-derived from the model's window when known). |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` | Higher-quality web search. Unset → keyless DuckDuckGo. |
| `ZENO_DATA_DIR` | Data root (default `./data`). |

### Docker (production shape)

```bash
ZENO_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
docker compose up --build
```

Brings up Zeno + PostgreSQL (pgvector image) + the isolated execution sandbox.

## The unified experience

Type naturally. Zeno decides:

- *"Explain event loops"* → direct conversational answer.
- *"What's new in Node 24?"* → `web_search` / `browser_read`, grounded answer with activity cards.
- *"Save my notes to ideas.txt"* → `file_write` in your private workspace.
- *"Compute the variance of this dataset"* → `code_exec`, real stdout/stderr returned to the model.
- *"Remember that I prefer short answers"* → `memory_write`, stored for future conversations.
- *"Look up tomorrow's forecast with my weather plugin"* → your registered HTTP plugin or MCP tool runs over the Internet.
- *"Deploy the staging container"* → `terminal` pauses for your explicit approval before anything runs.

Approvals appear **inline in the conversation** with `Allow once / Allow for this task / Deny`. Every tool round is persisted, so reloading replays the full story.

## Tools available to the model

Built in: `web_search` · `browser_read` · `http_request`* · `file_read` · `file_list` · `file_write` · `file_edit` · `file_delete`* · `terminal`* · `code_exec`* · `memory_search` · `memory_write` — (*) sensitive: require human approval per use (or per task with standing approval) under Ask Before Change. Workspace file tools are additionally `workspaceSafe`, so Workspace Edit mode runs them without asking. Web tools are SSRF-guarded: private ranges, link-local, and metadata endpoints are unreachable.

With the local bridge enabled, the `local_*` family (`local_read` · `local_list` · `local_write` · `local_edit` · `local_delete`) adds authorized filesystem access outside the workspace — always approval-gated except under Full Access.

**Bring your own**, from *Tools & connections*:

| Kind | Transport | Notes |
| --- | --- | --- |
| **HTTP plugin** | `POST` to a fixed endpoint, body `{"arguments": {…}}` | You define the tool name, description, and JSON Schema. The model fills the arguments; it can never change the URL, method, or request shape. |
| **MCP server** | Streamable HTTP (`initialize` → `notifications/initialized` → `tools/list` → `tools/call`), JSON or SSE responses | Tools are discovered live and namespaced per server. |

Connectors are scoped to your account, only enabled ones are offered, secrets are encrypted at rest, and every call is approval-gated. `stdio`, legacy SSE, and WebSocket MCP transports are not supported and are reported as such.

## API sketch

REST under `/api` (cookie or `Bearer` session). Notable endpoints:

```
POST /auth/register|login|logout       GET  /auth/me
GET|POST|PATCH|DELETE /providers[...]  POST /providers/:id/test  GET /providers/:id/models
GET|POST|PATCH|DELETE /connectors[...] PATCH /connectors/:id/enabled
POST /connectors/:id/discover|test
GET  /harness                          GET|PATCH /harness/settings
GET|POST|PATCH|DELETE /harness/skills[...]  POST /harness/skills/match
GET|POST|PATCH|DELETE /harness/plugins[...] POST /harness/plugins/:id/test
POST /chat/stream                      (SSE: delta|reasoning|activity|approval_required|done)
GET|POST|PATCH|DELETE /conversations   GET  /conversations/:id/messages
GET|POST|PATCH|DELETE /projects
GET|POST|PATCH|DELETE /agents          (backend capability; no separate UI surface)
POST /runs                             GET  /runs/:id  GET  /runs/:id/events (SSE)
POST /runs/approvals/:id               POST /runs/:id/cancel   GET /runs/tools
GET|POST|PATCH|DELETE /memory          POST /memory/search
GET|POST /files (multipart)            GET|PATCH /settings
GET  /decision/preview?q=              GET|POST /decision/stats[/reset]
GET  /cost/summary
GET  /health
```

## Tests

```bash
npm start                          # then, in another shell:
node scripts/smoke.js              # boots a stub provider fixture, drives the E2E suite
npm run test:connectors            # connector unit/integration tests (isolated DB + mock transport)
npm run test:features              # permission modes + policy rules, Plan Mode, unified event log,
                                   # memory pipeline, local bridge, daemon pairing + relay e2e
npm run test:intelligence          # decision layer, model routing, cost governor, parallel dispatch,
                                   # verification, retry policy + E2E (routing stays chat vs agent,
                                   # settings validation, remote-Jev degradation, cost/stats APIs)
node scripts/websearch.test.js     # web_search parser fixtures (no network)
npm run test:ui                    # real-browser UI checks (headless Chrome via CDP; needs a running server)
```

The end-to-end suite drives real HTTP: auth + cross-user isolation, gateway streaming, persistence, regenerate, uploads with extraction, unified tool turns, inline approval round-trips, memory search, and live SSE. The feature suite proves the new agent controls end-to-end: each permission mode actually gates terminal/file execution, the Plan Mode flow (plan → approval → execution → persisted plan), the memory pipeline (reinforce/supersede/score/consolidate), and the local bridge (root enforcement + CRUD). The intelligence suite proves the decision layer and its guarantees: simple requests stay simple, research/code requests go agentic, tier selection is cost-aware, budgets downgrade or block, independent tool calls genuinely overlap while sensitive ones serialize, verification levels apply by risk, and a configured-but-failing remote Jev provider degrades to the deterministic classifier without breaking a turn. The UI suite drives a real browser: skip-link behavior, sidebar geometry, Settings tabs (including Intelligence and Cost & Usage), the capability surface, mobile drawer layout — plus the agent surface: the permission chip (switch + persistence), Plan Mode card with inline approval, tool activity cards, verification cards, and the VS Code-style file preview.

## Honest limitations

- **Computer Use / full browser automation** (clicking GUIs, screenshots) requires a Playwright-capable browser environment; Zeno's architecture reserves the integration point (tool registry + sandbox service) but ships `browser_read` (real HTTP retrieval with readable-text extraction) as the browser capability that works everywhere. When a visual browser tool is added, it registers like any other tool — no core changes.
- **MCP transport coverage** is limited to streamable HTTP. Local `stdio` servers are not launched by the server process; wrap them in an HTTP bridge to connect them.
- Background `agent_runs` remain available as a backend capability for durable work, but the product surface is the unified chat.
- Memory embeddings store as JSON in PostgreSQL by default; for large corpora enable pgvector and move to a vector column (schema documented in `backend/database/schema.postgres.sql`).
- The bundled frontend is served same-origin by the backend; set `ZENO_CORS_ORIGINS` only if you host it separately.

---

MIT licensed. Built to be a real product, not a demo.
