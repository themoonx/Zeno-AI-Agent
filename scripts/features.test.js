





import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3100;
const STUB_PORT = 9102;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setupUser() {
  const email = `feat_${Date.now()}@test.dev`;
  const reg = await api('POST', '/auth/register', { email, displayName: 'Feature Tester', password: 'testpass123' });
  const token = reg.json.token;
  const prov = await api('POST', '/providers', { kind: 'openai-compatible', name: 'Stub', baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, apiKey: 'sk-stub', test: true }, token);
  const model = await api('POST', `/providers/${prov.json.provider.id}/models`, { modelId: 'stub-chat-1', displayName: 'Stub Chat', capabilities: ['chat', 'tools'] }, token);
  await api('PATCH', '/settings', { settings: { default_model: { modelId: model.json.model.id } } }, token);
  return token;
}

async function chatTurn(token, content, extra = {}) {
  const conv = (await api('POST', '/conversations', { title: 'F' }, token)).json.conversation;
  const res = await fetch(BASE + '/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId: conv.id, content, mode: 'send', ...extra }),
  });
  const frames = [];
  let approvalFrame = null;
  let approvalResolve = null;
  const approvalPending = new Promise((r) => (approvalResolve = r));
  let approved = false;
  await readSse(res, (ev) => {
    frames.push(ev);
    if (ev.type === 'approval_required' && !approved) {
      approved = true;
      approvalFrame = ev;
      api('POST', `/runs/approvals/${ev.approvalId}`, { decision: 'approved', scope: 'once' }, token);
      approvalResolve(ev);
    }
  });
  
  approvalResolve(null);
  return { frames, conv, approvalFrame };
}

async function main() {
  console.log('── Zeno new-features verification ─────────────────────────');

  
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-local-'));
  const stub = spawn(process.execPath, [path.join(import.meta.dirname, 'stub-provider.js')], { env: { ...process.env, STUB_PORT: String(STUB_PORT), ZENO_LOCAL_ROOTS: localRoot }, stdio: 'ignore' });
  const server = spawn(process.execPath, ['backend/server.js'], {
    env: { ...process.env, PORT: String(PORT), ZENO_LOCAL_BRIDGE: '1', ZENO_LOCAL_ROOTS: localRoot },
    stdio: 'ignore',
  });
  await wait(2200);

  try {
    
    
    let health = null;
    for (let i = 0; i < 30; i++) {
      const res = await api('GET', '/health').catch(() => null);
      if (res?.status === 200) { health = res; break; }
      await wait(500);
    }
    ok('server up with local bridge', health?.status === 200);

    
    const token = await setupUser();

    await api('PATCH', '/settings', { settings: { permission_mode: 'ask' } }, token);
    const askTurn = await chatTurn(token, 'USE_TERMINAL: compute');
    ok('ask mode: terminal requires approval', askTurn.frames.some((f) => f.type === 'approval_required' && f.tool === 'terminal'));

    await api('PATCH', '/settings', { settings: { permission_mode: 'full' } }, token);
    const fullTurn = await chatTurn(token, 'USE_TERMINAL: compute');
    ok('full mode: terminal runs without approval', !fullTurn.frames.some((f) => f.type === 'approval_required') && fullTurn.frames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && (f.output || '').includes('42')));

    await api('PATCH', '/settings', { settings: { permission_mode: 'workspace' } }, token);
    const wsTurn = await chatTurn(token, 'USE_TERMINAL: compute');
    ok('workspace mode: terminal still asks (not a workspace file)', wsTurn.frames.some((f) => f.type === 'approval_required' && f.tool === 'terminal'));

    const wsWrite = await chatTurn(token, 'USE_FILE_TOOL: write wsauto.txt');
    ok('workspace mode: workspace file_write runs without approval', !wsWrite.frames.some((f) => f.type === 'approval_required') && wsWrite.frames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && f.ok === true));
    const writeResult = wsWrite.frames.find((f) => f.type === 'activity' && f.kind === 'tool_result');
    ok('file_write result carries a preview payload for the chat UI', !!writeResult?.file?.path && typeof writeResult.file.content === 'string');

    
    await api('PATCH', '/settings', { settings: { permission_mode: 'ask', plan_mode: true } }, token);
    const planTurn = await chatTurn(token, 'USE_FILE_TOOL: write planned.txt');
    const planFrame = planTurn.frames.find((f) => f.type === 'plan' && f.phase === 'ready');
    ok('plan mode: plan frame streamed with steps', !!planFrame && Array.isArray(planFrame.steps) && planFrame.steps.length > 0, JSON.stringify(planFrame || {}).slice(0, 120));
    ok('plan mode: plan requires approval in ask mode', planFrame?.requiresApproval === true);
    const planApproval = planTurn.frames.find((f) => f.type === 'approval_required' && f.tool === 'plan');
    ok('plan mode: plan approval requested inline', !!planApproval);
    ok('plan mode: after approval the tool really ran', planTurn.frames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && f.ok === true && f.tool === 'file_write'));
    const msgs = (await api('GET', `/conversations/${planTurn.conv.id}`, null, token)).json.messages;
    ok('plan persisted as a replayable message', msgs.some((m) => m.attachments?.kind === 'plan' && m.attachments?.status === 'approved'));

    
    await api('PATCH', '/settings', { settings: { plan_mode: false } }, token);
    await api('POST', '/memory', { kind: 'preference', content: 'User prefers concise answers with examples' }, token);
    await api('POST', '/memory', { kind: 'preference', content: 'User prefers concise answers with examples' }, token);
    const list1 = (await api('GET', '/memory', null, token)).json;
    const prefCount = list1.memories.filter((m) => m.content.includes('concise answers')).length;
    ok('duplicate memory reinforced instead of duplicated', prefCount === 1, `count=${prefCount}`);

    
    await api('POST', '/memory', { kind: 'preference', content: 'User prefers brief concise answers' }, token);
    const list2 = (await api('GET', '/memory', null, token)).json;
    const active = list2.memories.filter((m) => m.status === 'active' && m.content.toLowerCase().includes('prefers'));
    ok('conflicting memory superseded the old one', active.length === 1 && active[0].content.includes('brief'), JSON.stringify(active.map((m) => m.content)));

    const search = await api('POST', '/memory/search', { query: 'how does the user like answers' }, token);
    ok('memory search returns scored results', search.json.results.length > 0 && typeof search.json.results[0].score === 'number');

    const consolidate = await api('POST', '/memory/consolidate', {}, token);
    ok('consolidation runs and reports stats', consolidate.status === 200 && typeof consolidate.json.merged === 'number' && typeof consolidate.json.remaining === 'number');

    
    
    
    process.env.ZENO_LOCAL_BRIDGE = '1';
    process.env.ZENO_LOCAL_ROOTS = localRoot;
    const { localFsAvailable, localTools } = await import('../backend/tools/local-bridge.js');
    ok('local bridge enabled via env', localFsAvailable('anyone'));
    const tools = Object.fromEntries(localTools.map((t) => [t.name, t]));
    const ctx = { userId: 'unit-test' };
    const target = path.join(localRoot, 'hello.py');
    const w = await tools.local_write.execute({ path: target, content: 'print("hello from your computer")\n' }, ctx);
    ok('local_write creates a real file at the authorized root', w.ok === true && fs.existsSync(target));
    const r = await tools.local_read.execute({ path: target }, ctx);
    ok('local_read returns the file content', r.ok === true && r.content.includes('hello from your computer'));
    const e = await tools.local_edit.execute({ path: target, find: 'hello', replace: 'hi' }, ctx);
    ok('local_edit replaces an exact snippet', e.ok === true && e.replacements === 1);
    const r2 = await tools.local_read.execute({ path: target }, ctx);
    ok('edited content visible on read-back', r2.content.includes('print("hi'));
    const outside = await tools.local_write.execute({ path: path.join(os.tmpdir(), 'outside-roots.txt'), content: 'x' }, ctx).catch((err) => ({ error: err.message }));
    ok('paths outside authorized roots are rejected', outside.ok !== true);
    const d = await tools.local_delete.execute({ path: target }, ctx);
    ok('local_delete removes the file', d.ok === true && !fs.existsSync(target));

    const localToolNames = (await api('GET', '/runs/tools', null, token)).json.tools.map((t) => t.name);
    ok('local tools offered through the harness catalog', ['local_read', 'local_write', 'local_edit', 'local_delete', 'local_list'].every((n) => localToolNames.includes(n)));

    
    const runRow = (await api('GET', `/runs`, null, token)).json;
    const chatRuns = (runRow.runs || []).filter((r) => r.kind === 'chat');
    ok('chat turns persisted as first-class runs', chatRuns.length > 0, JSON.stringify((runRow.runs || []).slice(0, 2).map((r) => r.kind)));
    if (chatRuns.length) {
      const evs = (await api('GET', `/runs/${chatRuns[0].id}`, null, token)).json.events || [];
      ok('chat turn events persisted to the session log', evs.some((e) => e.type === 'turn/start') && evs.some((e) => e.type === 'user/message'), `types=${[...new Set(evs.map((e) => e.type))].join(',')}`);
    }

    
    const rule = await api('POST', '/control/permissions/rules', { subject: 'shell.exec:*', effect: 'deny' }, token);
    ok('policy rule created', rule.status === 201 && rule.json.rule?.effect === 'deny');
    await api('PATCH', '/settings', { settings: { permission_mode: 'full' } }, token);
    const deniedTurn = await chatTurn(token, 'USE_TERMINAL: compute');
    ok('policy deny beats Full Access', deniedTurn.frames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && f.denied && (f.output || '').includes('policy')));
    await api('PATCH', '/settings', { settings: { permission_mode: 'ask' } }, token);
    await api('DELETE', `/control/permissions/rules/${rule.json.rule.id}`, null, token);

    const preview = await api('POST', '/control/permissions/preview', { tool: 'file_write', path: 'C:/work/x.txt' }, token);
    ok('permissions preview endpoint returns a verdict', !!preview.json.decision, JSON.stringify(preview.json));

    
    const skillLoad = (await api('POST', '/harness/skills/match', { query: 'deep research on webgpu' }, token)).json;
    ok('skill match still works for the roster', Array.isArray(skillLoad.matched));
    const tools2 = (await api('GET', '/runs/tools', null, token)).json.tools;
    ok('skill_load offered as a capability', tools2.some((t) => t.name === 'skill_load'), tools2.map((t) => t.name).join(','));

    
    const pair = await api('POST', '/control/environments/agents', { name: 'Test Laptop', roots: localRoot }, token);
    ok('local agent pairing created', pair.status === 201 && !!pair.json.token, JSON.stringify(pair.json.agent || {}));
    const daemonToken = pair.json.token;
    const daemon = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'local-agent', 'agent.js'), '--server', BASE, '--token', daemonToken, '--roots', localRoot], { stdio: 'ignore' });
    let daemonFile = path.join(localRoot, 'daemon-e2e.txt');
    try {
      
      let online = false;
      for (let i = 0; i < 20; i++) {
        await wait(500);
        const env = (await api('GET', '/control/environments', null, token)).json;
        if (env.agents.some((a) => a.online)) { online = true; break; }
      }
      ok('daemon connects and shows online', online);

      
      
      
      await api('PATCH', '/settings', { settings: { permission_mode: 'full' } }, token);
      const daemonTurn = await chatTurn(token, 'USE_LOCAL_TOOL: write daemon-e2e.txt');
      const localResult = daemonTurn.frames.find((f) => f.type === 'activity' && f.kind === 'tool_result' && f.tool === 'local_write');
      ok('local_write executed through the daemon relay', localResult?.ok === true, (localResult?.output || '').slice(0, 120));
      ok('file really landed on disk via the daemon', fs.existsSync(daemonFile), daemonFile);
      if (fs.existsSync(daemonFile)) {
        ok('daemon-written content matches', fs.readFileSync(daemonFile, 'utf8').includes('local agent relay'));
      }
      
      const refused = await api('POST', '/control/permissions/preview', { tool: 'local_write', path: path.join(os.tmpdir(), 'outside.txt') }, token);
      ok('outside-root preview verdict computed', ['allow', 'ask', 'deny'].includes(refused.json.decision));
    } finally {
      daemon.kill();
    }
    await api('DELETE', `/control/environments/agents/${pair.json.agent.id}`, null, token);

    
    
    
    await api('PATCH', '/settings', { settings: { permission_mode: 'full' } }, token);
    const me = (await api('GET', '/auth/me', null, token)).json;
    const userId = me.user?.id;
    const undoTurn = await chatTurn(token, 'USE_FILE_TOOL: write undome.txt');
    const undoFile = path.resolve(import.meta.dirname, '..', 'data', 'workspaces', String(userId), 'undome.txt');
    ok('undo: file really written into the workspace', fs.existsSync(undoFile), undoFile);
    let stack = (await api('GET', `/chat/snapshot-stack?conversationId=${undoTurn.conv.id}`, null, token)).json;
    ok('undo: stack derived from the event log (canUndo)', stack.canUndo === true, JSON.stringify(stack));
    const undoRes = await api('POST', '/chat/undo', { conversationId: undoTurn.conv.id }, token);
    ok('undo: restores the pre-mutation workspace', undoRes.status === 200 && undoRes.json.ok === true && !fs.existsSync(undoFile), JSON.stringify(undoRes.json || {}).slice(0, 160));
    const redoRes = await api('POST', '/chat/redo', { conversationId: undoTurn.conv.id }, token);
    ok('redo: re-applies the undone change', redoRes.status === 200 && redoRes.json.ok === true && fs.existsSync(undoFile));
    const undoMsgs = (await api('GET', `/conversations/${undoTurn.conv.id}`, null, token)).json.messages;
    ok('undo/redo persisted as replayable snapshot rows', undoMsgs.some((m) => m.attachments?.kind === 'snapshot' && m.attachments?.action === 'undo') && undoMsgs.some((m) => m.attachments?.kind === 'snapshot' && m.attachments?.action === 'redo'));
    stack = (await api('GET', `/chat/snapshot-stack?conversationId=${undoTurn.conv.id}`, null, token)).json;
    ok('stack state tracks the redo pointer', stack.canUndo === true && stack.canRedo === false, JSON.stringify(stack));
    const emptyUndo = await api('POST', '/chat/undo', { conversationId: undoTurn.conv.id }, token);
    ok('second undo consumes the redo-point checkpoint (still consistent)', emptyUndo.status === 200 || emptyUndo.status === 400);

    
    
    
    await api('PATCH', '/settings', { settings: { permission_mode: 'ask' } }, token);
    const reevalConv = (await api('POST', '/conversations', { title: 'Reeval' }, token)).json.conversation;
    const reevalRes = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: reevalConv.id, content: 'USE_TERMINAL: compute', mode: 'send' }),
    });
    const reevalFrames = [];
    let reevalRuleId = null;
    let sawReevalApproval = false;
    await readSse(reevalRes, (ev) => {
      reevalFrames.push(ev);
      if (ev.type === 'approval_required' && ev.tool === 'terminal' && !sawReevalApproval) {
        sawReevalApproval = true;
        
        setTimeout(async () => {
          const created = await api('POST', '/control/permissions/rules', { subject: 'shell.exec:*', effect: 'allow' }, token);
          reevalRuleId = created.json?.rule?.id || null;
        }, 400);
      }
    });
    ok('policy re-evaluation: pending approval auto-resolved by the new allow rule', reevalFrames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && f.ok === true && f.tool === 'terminal'), reevalFrames.map((f) => `${f.type}:${f.kind || f.phase || ''}`).join(','));
    const pendingAfter = (await api('GET', '/runs/approvals/pending', null, token)).json.approvals;
    ok('policy re-evaluation: nothing left pending', (pendingAfter || []).length === 0, JSON.stringify(pendingAfter || []).slice(0, 120));
    if (reevalRuleId) await api('DELETE', `/control/permissions/rules/${reevalRuleId}`, null, token);

    
    const badCron = await api('POST', '/schedules', { name: 'Bad', cron: 'not-a-cron', task: 'x' }, token);
    ok('schedules: invalid cron rejected', badCron.status === 400);
    const sched = await api('POST', '/schedules', { name: 'Nightly digest', cron: '* * * * *', task: 'Summarize the workspace.' }, token);
    ok('schedules: created with a computed next run', sched.status === 201 && typeof sched.json.schedule?.nextRunAt === 'number', JSON.stringify(sched.json || {}));
    const trig = await api('POST', `/schedules/${sched.json.schedule.id}/trigger`, null, token);
    ok('schedules: manual trigger starts a run', trig.status === 202 && !!trig.json.runId, JSON.stringify(trig.json || {}));
    const schedRunRow = (await api('GET', `/runs/${trig.json.runId}`, null, token)).json;
    ok('schedules: triggered run is a real first-class run', !!schedRunRow.run);
    const schedRuns = (await api('GET', `/schedules/${sched.json.schedule.id}/runs`, null, token)).json;
    ok('schedules: occurrence recorded with the run', (schedRuns.runs || []).some((r) => r.runId === trig.json.runId));
    const dis = await api('PATCH', `/schedules/${sched.json.schedule.id}`, { enabled: false }, token);
    ok('schedules: disable works', dis.json.schedule?.enabled === false);
    await api('DELETE', `/schedules/${sched.json.schedule.id}`, null, token);
    ok('schedules: delete works', (await api('GET', '/schedules', null, token)).json.schedules.length === 0);

    
    const telemetry = (await api('GET', '/control/telemetry?sinceHours=24', null, token)).json.summary;
    ok('telemetry: model calls recorded', telemetry && Number(telemetry.modelCalls) > 0, JSON.stringify(telemetry || {}));
    ok('telemetry: tool executions recorded', Number(telemetry?.toolCalls) > 0);
    ok('telemetry: permission decisions recorded', Number(telemetry?.byKind?.['permission.decision'] || 0) > 0);

    
    const { projectPlan, projectUsage, projectSubagents, projectReviews, projectMessageRows } = await import('../backend/kernel/projections.js');
    const synthEvents = [
      { seq: 1, type: 'user/message', data: { content: 'hello', messageId: 'm1' } },
      { seq: 2, type: 'plan/created', data: { planId: 'p1', understanding: 'u', steps: [{ title: 'a' }, { title: 'b' }], requiresApproval: true } },
      { seq: 3, type: 'plan/approved', data: { planId: 'p1' } },
      { seq: 4, type: 'subagent/assigned', data: { subSessionId: 's1', task: 'research' } },
      { seq: 5, type: 'subagent/completed', data: { subSessionId: 's1', result: 'ok', usage: { promptTokens: 5, completionTokens: 3 } } },
      { seq: 6, type: 'review/findings', data: { reviewId: 'r1', verdict: 'needs-attention', findings: [{ severity: 'high', issue: 'bug' }] } },
      { seq: 7, type: 'assistant/message', data: { text: 'done', usage: { promptTokens: 10, completionTokens: 4 } } },
    ];
    const plan = projectPlan(synthEvents);
    ok('projection: plan state (pending → approved)', plan?.planId === 'p1' && plan?.status === 'approved' && plan?.steps?.length === 2);
    const usage = projectUsage(synthEvents);
    ok('projection: usage rolls up transcript events', usage.promptTokens === 10 && usage.completionTokens === 4);
    const subs = projectSubagents(synthEvents);
    ok('projection: subagent lifecycle (assigned → done)', subs.length === 1 && subs[0].status === 'done' && subs[0].result === 'ok');
    const reviews = projectReviews(synthEvents);
    ok('projection: review findings extracted', reviews.length === 1 && reviews[0].verdict === 'needs-attention' && reviews[0].findings.length === 1);
    const rows = projectMessageRows(synthEvents);
    ok('projection: message rows rebuild the chat thread', rows[0].role === 'user' && rows[rows.length - 1].role === 'assistant' && rows[rows.length - 1].content === 'done');
  } finally {
    stub.kill();
    server.kill();
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log(` ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Feature test crashed:', err);
  process.exit(1);
});
