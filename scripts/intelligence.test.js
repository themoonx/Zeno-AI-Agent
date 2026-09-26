






import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3110;
const STUB_PORT = 9104;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));


console.log('── Decision heuristics (deterministic System One) ──────────');
{
  const { classify } = await import('../backend/decision/heuristics.js');
  const tools = new Set(['web_search', 'browser_read', 'file_write', 'terminal', 'code_exec', 'memory_search']);

  const greet = classify('hey there!', { hasTools: true, toolNames: tools });
  ok('greeting stays in direct chat', greet.executionMode === 'chat' && greet.confidence >= 0.9, JSON.stringify(greet));

  const explain = classify('What is an event loop and why does Node use it?', { hasTools: true, toolNames: tools });
  ok('conceptual question stays in direct chat', explain.executionMode === 'chat', JSON.stringify(explain));

  const research = classify('Research the latest developments in solid state batteries, compare the major approaches, and write a report with sources', { hasTools: true, toolNames: tools });
  ok('multi-source research routes to the research agent', research.executionMode === 'agent' && research.taskType === 'research', JSON.stringify(research));
  ok('research gets standard verification + a balanced/reasoning tier', ['standard'].includes(research.verification) && ['balanced', 'reasoning'].includes(research.modelTier), JSON.stringify(research));

  const code = classify('Fix this bug in my Python script and run the unit tests', { hasTools: true, toolNames: tools });
  ok('code request routes to the coding agent', code.executionMode === 'agent' && code.taskType === 'code', JSON.stringify(code));

  const destructive = classify('Delete all files in the workspace and then deploy to production', { hasTools: true, toolNames: tools });
  ok('destructive multi-step request is high risk and strictly verified', destructive.executionMode === 'agent' && destructive.risk === 'high' && destructive.verification === 'strict', JSON.stringify(destructive));

  const noTools = classify('What is 2+2?', { hasTools: false, toolNames: new Set() });
  ok('no tool capacity always degrades to chat', noTools.executionMode === 'chat', JSON.stringify(noTools));

  const { coerceDecision } = await import('../backend/decision/heuristics.js');
  const fallback = classify('fix the bug', { hasTools: true, toolNames: tools });
  const coerced = coerceDecision({ executionMode: 'WAT', modelTier: 'turbo', confidence: 7, taskType: 'research' }, fallback);
  ok('remote decisions are coerced to the safe schema (bad fields fall back, confidence clamps)', coerced.executionMode === 'agent' && coerced.modelTier === fallback.modelTier && coerced.confidence === 1 && coerced.taskType === 'research', JSON.stringify(coerced));
}


console.log('── ModelRouter tier classification ─────────────────────────');
{
  const { classifyModelRow } = await import('../backend/routing/model-router.js');
  const row = (modelId, params = {}, capabilities = ['chat']) => ({ modelId, params, capabilities });
  ok('mini-tier model classifies as fast', classifyModelRow(row('gpt-4o-mini')) === 'fast');
  ok('flash model classifies as fast', classifyModelRow(row('gemini-2.0-flash')) === 'fast');
  ok('o3 classifies as reasoning', classifyModelRow(row('o3')) === 'reasoning');
  ok('deepseek-reasoner classifies as reasoning', classifyModelRow(row('deepseek-reasoner')) === 'reasoning');
  ok('opus classifies as premium', classifyModelRow(row('claude-opus-4-1')) === 'premium');
  ok('ollama provider forces local tier', classifyModelRow(row('llama3.1:70b'), 'ollama') === 'local');
  ok('explicit user override wins over heuristics', classifyModelRow(row('gpt-4o', { routing_tier: 'fast' })) === 'fast');
  ok('unknown ids default to balanced', classifyModelRow(row('stub-chat-1')) === 'balanced');
}


console.log('── ModelRouter purpose routing ─────────────────────────────');
{
  const { createModelRouter } = await import('../backend/routing/model-router.js');
  const models = [
    { id: 'm_premium', providerId: 'p1', modelId: 'claude-opus-4-1', displayName: 'Opus', params: {}, capabilities: ['chat'] },
    { id: 'm_balanced', providerId: 'p1', modelId: 'gpt-4.1', displayName: 'GPT', params: {}, capabilities: ['chat'] },
    { id: 'm_fast', providerId: 'p1', modelId: 'gpt-4o-mini', displayName: 'Mini', params: {}, capabilities: ['chat'] },
    { id: 'm_local', providerId: 'p2', modelId: 'llama3.1:8b', displayName: 'Llama', params: {}, capabilities: ['chat'] },
  ];
  const repos = {
    users: { getSetting: () => null },
    providers: {
      listModels: () => models,
      getModel: (userId, id) => models.find((m) => m.id === id) || null,
      getProvider: (userId, id) => ({ id, kind: id === 'p2' ? 'ollama' : 'openai-compatible', status: 'ok' }),
    },
  };
  const router = createModelRouter({ repos });
  const decision = { executionMode: 'agent', modelTier: 'reasoning', taskType: 'code', confidence: 0.9 };

  const offRouter = createModelRouter({ repos: { ...repos, users: { getSetting: (u, k) => (k === 'model_routing' ? { mode: 'off' } : null) } } });
  ok('off mode never reroutes', offRouter.purposeModel({ userId: 'u', requested: 'm_balanced', purpose: 'planning', decision }) === 'm_balanced');

  const auxRouter = createModelRouter({ repos: { ...repos, users: { getSetting: (u, k) => (k === 'model_routing' ? { mode: 'aux' } : null) } } });
  ok('aux mode routes planning to the fast tier', auxRouter.purposeModel({ userId: 'u', requested: 'm_premium', purpose: 'planning', decision }) === 'm_fast');
  ok('aux mode keeps the main loop on the requested model', auxRouter.purposeModel({ userId: 'u', requested: 'm_premium', purpose: 'main', decision }) === 'm_premium');

  const fullRouter = createModelRouter({ repos: { ...repos, users: { getSetting: (u, k) => (k === 'model_routing' ? { mode: 'full' } : null) } } });
  ok('full mode routes the agent main loop by the decision tier', fullRouter.purposeModel({ userId: 'u', requested: 'm_fast', purpose: 'main', decision }) === 'm_balanced');
  ok('tier selection prefers the requested tier, then falls back cheaper before dearer (no reasoning model → balanced)', fullRouter.select('u', 'reasoning')?.id === 'm_balanced');

  ok('escalation goes one tier up', (() => {
    const esc = fullRouter.escalationModel('u', 'm_fast');
    return esc && esc.id === 'm_balanced';
  })());
  ok('escalation at the top tier returns null', fullRouter.escalationModel('u', 'm_premium') === null);
}


console.log('── Retry intelligence ──────────────────────────────────────');
{
  const { classifyError, createDecisionEngine } = await import('../backend/decision/engine.js');
  ok('429 → RATE_LIMIT', classifyError({ status: 429 }) === 'RATE_LIMIT');
  ok('401 → AUTH (never retried)', classifyError({ status: 401 }) === 'AUTH');
  ok('ECONNRESET → NETWORK', classifyError(new Error('fetch failed: ECONNRESET')) === 'NETWORK');
  ok('context length → INVALID_ARGUMENT (never retried)', classifyError(new Error('maximum context length exceeded')) === 'INVALID_ARGUMENT');
  ok('500 → TRANSIENT', classifyError({ status: 500 }) === 'TRANSIENT');

  const engine = createDecisionEngine({ repos: { users: { getSetting: () => null }, intelligence: {} } });
  ok('retryable class retries with backoff', engine.retryPlan({ failureClass: 'RATE_LIMIT', attempt: 0 }).action === 'retry');
  ok('permanent class aborts immediately', engine.retryPlan({ failureClass: 'AUTH', attempt: 0 }).action === 'abort');
  ok('exhausted retries escalate', engine.retryPlan({ failureClass: 'TRANSIENT', attempt: 2, maxAttempts: 2 }).action === 'escalate');
  const plan = engine.retryPlan({ failureClass: 'TRANSIENT', attempt: 0 });
  ok('backoff delay is bounded and jittered', plan.delayMs > 200 && plan.delayMs <= 2000, String(plan.delayMs));
}


console.log('── CostGovernor ────────────────────────────────────────────');
{
  const { createCostGovernor, priceFor, estimateCost } = await import('../backend/routing/cost.js');
  ok('user pricing wins over the built-in table', priceFor({ modelId: 'gpt-4o', params: { pricing: { inputPerMTok: 9, outputPerMTok: 9 } } }).source === 'user');
  ok('built-in pricing applies to known ids', priceFor({ modelId: 'gpt-4o', params: {} }).in === 2.5);
  ok('local providers price at zero', priceFor({ modelId: 'llama3', params: {} }, 'ollama').in === 0);
  const est = estimateCost({ modelId: 'gpt-4o', params: {} }, { promptTokens: 1_000_000, completionTokens: 0 });
  ok('cost estimate math is linear per MTok', Math.abs(est.usd - 2.5) < 1e-9);

  const spent = { day: { cost: 0.9, requests: 10 }, month: { cost: 0.9, requests: 10 } };
  const stubRepos = {
    users: { getSetting: (u, k) => (k === 'cost_governor' ? { per_day_usd: 1.0, per_request_usd: null, per_month_usd: null, action: 'downgrade' } : null) },
    intelligence: {
      usageDaySpend: () => spent.day,
      usageMonthSpend: () => spent.month,
      recordUsage: (r) => { ledger.push(r); },
      turnCost: () => ({ cost: 0, promptTokens: 0, completionTokens: 0 }),
    },
  };
  const ledger = [];
  const gov = createCostGovernor({ repos: stubRepos });
  const modelRow = { id: 'm', modelId: 'gpt-4o', params: {}, providerId: 'p1' };
  const verdict = gov.authorize({ userId: 'u', modelRow, purpose: 'turn', promptTokens: 4_000_000, completionTokens: 0 });
  ok('day budget breach with downgrade action allows + flags downgrade', verdict.allowed === true && verdict.downgrade === true, JSON.stringify(verdict));
  ok('downgrade action avoids the block path', verdict.allowed !== false);

  const blockRepos = { ...stubRepos, users: { getSetting: (u, k) => (k === 'cost_governor' ? { per_day_usd: 1.0, action: 'block' } : null) } };
  const blockGov = createCostGovernor({ repos: blockRepos });
  const blocked = blockGov.authorize({ userId: 'u', modelRow, purpose: 'turn', promptTokens: 4_000_000, completionTokens: 0 });
  ok('block action refuses the call with a reason', blocked.allowed === false && /budget/.test(blocked.reason), JSON.stringify(blocked));

  const fine = blockGov.authorize({ userId: 'u', modelRow, purpose: 'turn', promptTokens: 10_000, completionTokens: 1_000 });
  ok('within-budget calls pass', fine.allowed === true);
  blockGov.record({ userId: 'u', modelRow, purpose: 'turn', promptTokens: 100, completionTokens: 10 });
  ok('completed calls land in the ledger', ledger.length === 1 && ledger[0].modelId === 'gpt-4o');
}


console.log('── VerificationEngine ──────────────────────────────────────');
{
  const { createVerificationEngine } = await import('../backend/agent/verification.js');
  const repos = { users: { getSetting: (u, k) => (k === 'verification' ? { minimum_level: 'standard' } : null) } };
  const ve = createVerificationEngine({ repos, gateway: {} });
  ok('level floor raises verification for light turns', ve.levelFor({ verification: 'basic' }, 'u') === 'standard');
  ok('level floor never lowers a stricter decision', ve.levelFor({ verification: 'strict' }, 'u') === 'strict');
  const contradictions = ve.numericContradictions(
    'The company grew revenue by $4.7B in 2024 and has 1,234 employees.',
    'Sources report revenue growth of $4.7B in 2024. Headcount is around 1,234 across 3 sites. In 2019 it was smaller.'
  );
  ok('numbers present in evidence are not flagged', contradictions.length === 0, JSON.stringify(contradictions));
  const flagged = ve.numericContradictions('The market reached $99.7B in 2024.', 'Analysts estimate the market at $47.3B in 2024.');
  ok('unsupported figures are flagged', flagged.length >= 1 && /99/.test(flagged[0].claim), JSON.stringify(flagged));

  const empty = await ve.verify({ userId: 'u', decision: { taskType: 'general', complexity: 'complex' }, level: 'basic', query: 'q', answer: '   ', modelRowId: 'x' });
  ok('basic verification catches empty answers', empty.ok === false && empty.issues.length === 1);
}


console.log('── Parallel tool dispatch ──────────────────────────────────');
{
  const { executeToolCalls } = await import('../backend/agent/orchestrator.js');
  const catalog = new Map([
    ['free_a', { name: 'free_a' }],
    ['free_b', { name: 'free_b' }],
    ['free_c', { name: 'free_c' }],
    ['free_d', { name: 'free_d' }],
    ['gated', { name: 'gated', sensitive: true }],
  ]);
  const tc = (name, i = 0) => ({ id: `c_${name}_${i}`, name, arguments: {} });
  const mkRunner = (delay) => async (call) => {
    const start = Date.now();
    await wait(delay);
    return { ok: true, output: `ran:${call.name}`, start, end: Date.now() };
  };

  const t0 = Date.now();
  const out4 = await executeToolCalls({ toolCalls: [tc('free_a'), tc('free_b'), tc('free_c'), tc('free_d')], catalog, runner: mkRunner(250), maxParallel: 6 });
  const wall4 = Date.now() - t0;
  ok('four non-sensitive calls run concurrently (well under 4x)', wall4 < 750, `${wall4}ms`);
  ok('results keep the original call order', out4.map((o) => o.output).join(',') === 'ran:free_a,ran:free_b,ran:free_c,ran:free_d');
  ok('concurrent calls actually overlap in time', out4[3].start - out4[0].start < 200, `spread ${out4[3].start - out4[0].start}ms`);

  const t1 = Date.now();
  const outGated = await executeToolCalls({ toolCalls: [tc('gated', 1), tc('gated', 2)], catalog, runner: mkRunner(200), maxParallel: 6 });
  const wallGated = Date.now() - t1;
  ok('sensitive calls stay strictly sequential (>= 2x delay)', wallGated >= 400, `${wallGated}ms`);
  ok('sensitive results keep call order', outGated.map((o) => o.output).join(',') === 'ran:gated,ran:gated');

  const t2 = Date.now();
  await executeToolCalls({ toolCalls: [tc('gated', 3), tc('free_a', 4), tc('free_b', 5)], catalog, runner: mkRunner(220), maxParallel: 6 });
  const wallMixed = Date.now() - t2;
  ok('mixed batches overlap free + gated lanes (under the sequential sum)', wallMixed < 620, `${wallMixed}ms`);

  const overflow = await executeToolCalls({ toolCalls: Array.from({ length: 5 }, (_, i) => tc('free_a', 10 + i)), catalog, runner: mkRunner(50), maxParallel: 2 });
  ok('results are complete and ordered past the parallel cap', overflow.length === 5 && overflow.every((o) => o.ok));
}


async function api(method, p, body, token) {
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) onEvent(JSON.parse(line.slice(5)));
    }
  }
}

async function chatTurn(token, content, extra = {}) {
  const conv = (await api('POST', '/conversations', { title: 'I' }, token)).json.conversation;
  const res = await fetch(BASE + '/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId: conv.id, content, mode: 'send', ...extra }),
  });
  const frames = [];
  await readSse(res, (ev) => {
    frames.push(ev);
    if (ev.type === 'approval_required') api('POST', `/runs/approvals/${ev.approvalId}`, { decision: 'approved', scope: 'task' }, token);
  });
  return { frames, conv };
}

console.log('── E2E: intelligence over real HTTP ────────────────────────');
const stub = spawn(process.execPath, [path.join(__dirname, 'stub-provider.js')], { env: { ...process.env, STUB_PORT: String(STUB_PORT) }, stdio: 'ignore' });
const server = spawn(process.execPath, ['backend/server.js'], { env: { ...process.env, PORT: String(PORT), ZENO_DATA_DIR: './data/_intelligence_test' }, stdio: 'ignore' });
let serverUp = false;
for (let i = 0; i < 40; i++) {
  await wait(500);
  try {
    const res = await api('GET', '/health');
    if (res.status === 200) { serverUp = true; break; }
  } catch {  }
}
ok('server up (isolated data dir)', serverUp);

try {
  const email = `intel_${Date.now()}@test.dev`;
  const reg = await api('POST', '/auth/register', { email, displayName: 'Intel Tester', password: 'testpass123' });
  const token = reg.json.token;
  const prov = await api('POST', '/providers', { kind: 'openai-compatible', name: 'Stub', baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, apiKey: 'sk-stub', test: true }, token);
  const model = await api('POST', `/providers/${prov.json.provider.id}/models`, { modelId: 'stub-chat-1', displayName: 'Stub Chat', capabilities: ['chat', 'tools'] }, token);
  await api('PATCH', '/settings', { settings: { default_model: { modelId: model.json.model.id } } }, token);

  
  const previewAgent = await api('GET', `/decision/preview?q=${encodeURIComponent('Research the latest developments in fusion energy and compare the leading approaches')}`, null, token);
  ok('preview routes research to agent mode', previewAgent.status === 200 && previewAgent.json.decision.executionMode === 'agent' && previewAgent.json.decision.taskType === 'research', JSON.stringify(previewAgent.json?.decision));
  const previewChat = await api('GET', `/decision/preview?q=${encodeURIComponent('hey there')}`, null, token);
  ok('preview keeps greetings in direct chat', previewChat.status === 200 && previewChat.json.willRouteAgent === false, JSON.stringify(previewChat.json));

  
  const chat = await chatTurn(token, 'hey there!');
  ok('direct chat turn completes with text', chat.frames.some((f) => f.type === 'done' && f.status === 'complete'));
  ok('direct chat offers no tools (no activity cards)', !chat.frames.some((f) => f.type === 'activity' && f.kind === 'tool_call'), JSON.stringify(chat.frames.filter((f) => f.type === 'activity').map((f) => f.kind)));

  
  await api('PATCH', '/settings', { settings: { permission_mode: 'full' } }, token);
  const agentTurn = await chatTurn(token, 'USE_TERMINAL: compute');
  ok('agent turn still executes tools end-to-end', agentTurn.frames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && (f.output || '').includes('42')), JSON.stringify(agentTurn.frames.filter((f) => f.type === 'activity').map((f) => f.kind)));

  
  await api('PATCH', '/settings', { settings: { verification: { enabled: true, minimum_level: 'strict' } } }, token);
  const verTurn = await chatTurn(token, 'USE_FILE_TOOL: write intel-verify.txt');
  ok('verification stage emits its activity card', verTurn.frames.some((f) => f.type === 'activity' && f.kind === 'verification'), JSON.stringify(verTurn.frames.filter((f) => f.type === 'activity').map((f) => f.kind)));
  ok('verified agent turn still completes with a final answer', verTurn.frames.some((f) => f.type === 'done' && f.status === 'complete'));
  await api('PATCH', '/settings', { settings: { verification: { enabled: true, minimum_level: 'none' } } }, token);

  
  const stats = await api('GET', '/decision/stats', null, token);
  ok('routing statistics accumulate per task type', stats.status === 200 && (stats.json.stats || []).length >= 1, JSON.stringify(stats.json));
  const reset = await api('POST', '/decision/stats/reset', {}, token);
  ok('routing statistics are resettable', reset.status === 200 && reset.json.ok === true);

  
  const badEndpoint = await api('PATCH', '/settings', { settings: { jev: { endpoint: 'ftp://nope' } } }, token);
  ok('jev endpoint must be http(s)', badEndpoint.status === 400);
  const badMode = await api('PATCH', '/settings', { settings: { model_routing: { mode: 'turbo' } } }, token);
  ok('model_routing.mode is enum-validated', badMode.status === 400);
  const goodJev = await api('PATCH', '/settings', { settings: { jev: { endpoint: `http://127.0.0.1:${STUB_PORT}/v1`, mode: 'openai', model: 'stub-chat-1', api_key: 'sk-secret-123', confidence_floor: 0.6 } } }, token);
  ok('valid jev config is accepted', goodJev.status === 200, JSON.stringify(goodJev.json));
  ok('jev api key never echoes back to the client', goodJev.json?.settings?.jev?.api_key === '__set__', JSON.stringify(goodJev.json?.settings?.jev));

  
  const degraded = await api('GET', `/decision/preview?q=${encodeURIComponent('research quantum computing breakthroughs')}`, null, token);
  ok('remote Jev failure degrades to the deterministic classifier', degraded.status === 200 && degraded.json.decision.source === 'heuristic' && degraded.json.decision.executionMode === 'agent', JSON.stringify(degraded.json?.decision));

  
  const cost = await api('GET', '/cost/summary', null, token);
  ok('cost summary exposes budgets + per-model pricing', cost.status === 200 && cost.json.budgets && typeof cost.json.pricing === 'object' && cost.json.pricing[model.json.model.id], JSON.stringify(Object.keys(cost.json || {})));
  ok('spend tracking recorded the stub turns (zero-priced but present)', typeof cost.json.today?.cost === 'number');
  const badBudget = await api('PATCH', '/settings', { settings: { cost_governor: { per_day_usd: -5 } } }, token);
  ok('negative budgets are rejected', badBudget.status === 400);

  
  
  await api('PATCH', '/settings', { settings: { research: { enabled: true, max_subqueries: 2 } } }, token);
  const researchTurn = await chatTurn(token, 'Research the history of Unix and give a short summary');
  ok('research turn completes without erroring', researchTurn.frames.some((f) => f.type === 'done') && !researchTurn.frames.some((f) => f.type === 'error'), JSON.stringify(researchTurn.frames.filter((f) => f.type === 'error').map((f) => f.message)));
} finally {
  stub.kill();
  server.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
