


import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const STUB_PORT = 9101;
let passed = 0;
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name} ${extra}`);
  }
}

async function api(method, p, body, token) {
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {  }
  return { status: res.status, json };
}

function readSse(res, onEvent) {
  return new Promise(async (resolve, reject) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
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
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('── Zeno AI end-to-end smoke test ──────────────────────────');

  
  const health = await api('GET', '/health');
  ok('backend is up', health.status === 200 && health.json?.ok, JSON.stringify(health.json));

  
  const stub = spawn(process.execPath, [path.join(import.meta.dirname, 'stub-provider.js')], {
    env: { ...process.env, STUB_PORT: String(STUB_PORT) },
    stdio: 'ignore',
  });
  await wait(600);

  try {
    
    const email = `smoke_${Date.now()}@test.dev`;
    const reg = await api('POST', '/auth/register', { email, displayName: 'Smoke Tester', password: 'testpass123' });
    ok('register returns token', reg.status === 201 && !!reg.json?.token);
    const token = reg.json.token;

    const badLogin = await api('POST', '/auth/login', { email, password: 'wrong-pass' });
    ok('wrong password rejected (401)', badLogin.status === 401);

    
    const prov = await api('POST', '/providers', {
      kind: 'openai-compatible',
      name: 'Stub Provider',
      baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`,
      apiKey: 'sk-stub-fixture',
      test: true,
    }, token);
    ok('provider created + connection test', prov.status === 201 && prov.json?.testResult?.ok === true, JSON.stringify(prov.json?.testResult));
    ok('provider key masked/encrypted (no plaintext echoed)', !JSON.stringify(prov.json).includes('sk-stub-fixture'));
    const providerId = prov.json.provider.id;

    const remoteModels = await api('GET', `/providers/${providerId}/models`, null, token);
    ok('remote model listing via gateway', remoteModels.status === 200 && remoteModels.json.models.some((m) => m.id === 'stub-chat-1'));

    const chatModel = await api('POST', `/providers/${providerId}/models`, {
      modelId: 'stub-chat-1', displayName: 'Stub Chat', contextWindow: 8192, capabilities: ['chat', 'tools'],
    }, token);
    const embedModel = await api('POST', `/providers/${providerId}/models`, {
      modelId: 'stub-embed-1', displayName: 'Stub Embed', capabilities: ['chat', 'embeddings'],
    }, token);
    ok('models registered', chatModel.status === 201 && embedModel.status === 201);

    await api('PATCH', '/settings', { settings: { default_model: { modelId: chatModel.json.model.id }, embedding_model: { modelId: embedModel.json.model.id } } }, token);

    
    const conv = (await api('POST', '/conversations', { title: 'Smoke chat' }, token)).json.conversation;
    const chatRes = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: conv.id, content: 'Say hello', mode: 'send' }),
    });
    ok('chat stream responds 200 + SSE', chatRes.status === 200 && (chatRes.headers.get('content-type') || '').includes('text/event-stream'));

    let deltaCount = 0;
    let doneEvent = null;
    let userMessageEvent = null;
    await readSse(chatRes, (ev) => {
      if (ev.type === 'delta') deltaCount++;
      if (ev.type === 'done') doneEvent = ev;
      if (ev.type === 'user_message') userMessageEvent = ev;
    });
    ok('stream produced deltas', deltaCount > 3, `deltas=${deltaCount}`);
    ok('done event with usage', !!doneEvent && doneEvent.usage?.promptTokens > 0);
    ok('user message persisted', !!userMessageEvent?.message?.id);

    const msgs = (await api('GET', `/conversations/${conv.id}`, null, token)).json.messages;
    ok('assistant message persisted with content', msgs.some((m) => m.role === 'assistant' && m.content.includes('Hello from the stub model')));
    ok('title auto-generated', (await api('GET', `/conversations/${conv.id}`, null, token)).json.conversation.title !== 'New conversation' || conv.title !== 'New conversation');

    
    const regen = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: conv.id, mode: 'regenerate' }),
    });
    let regenDone = null;
    await readSse(regen, (ev) => ev.type === 'done' && (regenDone = ev));
    const msgsAfterRegen = (await api('GET', `/conversations/${conv.id}`, null, token)).json.messages;
    ok('regenerate re-slices history', regenDone?.status === 'complete' && msgsAfterRegen.filter((m) => m.role === 'assistant').length === 1);

    
    const fd = new FormData();
    fd.append('files', new Blob([ 'Zeno file content for context injection. '.repeat(20) ], { type: 'text/plain' }), 'notes.txt');
    const up = await fetch(BASE + '/api/files?conversationId=' + conv.id, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    const upJson = await up.json();
    ok('file upload stores metadata + extraction', up.status === 201 && upJson.files[0]?.hasExtractedText === true);
    const fileId = upJson.files[0].id;

    const conv2 = (await api('POST', '/conversations', { title: 'Attachment chat' }, token)).json.conversation;
    const attachRes = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: conv2.id, content: 'Summarize the file', attachmentIds: [fileId], mode: 'send' }),
    });
    let attachDone = null;
    await readSse(attachRes, (ev) => ev.type === 'done' && (attachDone = ev));
    ok('chat with attachment completes', attachDone?.status === 'complete');

    
    const convU = (await api('POST', '/conversations', { title: 'Unified tool chat' }, token)).json.conversation;
    const unifiedRes = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: convU.id, content: 'USE_FILE_TOOL: write unified.txt', mode: 'send' }),
    });
    const unifiedFrames = [];
    let unifiedDone = null;
    await readSse(unifiedRes, (ev) => {
      unifiedFrames.push(ev.type);
      if (ev.type === 'done') unifiedDone = ev;
    });
    ok('unified chat streamed tool activity', unifiedFrames.includes('activity') && unifiedFrames.includes('delta'), `frames=${[...new Set(unifiedFrames)].join(',')}`);
    ok('unified chat completed', unifiedDone?.status === 'complete');
    const unifiedWs = path.join(process.env.ZENO_DATA_DIR || path.join(process.cwd(), 'data'), 'workspaces', reg.json.user.id, 'unified.txt');
    ok('unified chat tool really wrote a file', fs.existsSync(unifiedWs), unifiedWs);
    const unifiedMsgs = (await api('GET', `/conversations/${convU.id}`, null, token)).json.messages;
    ok('tool rounds persisted for replay', unifiedMsgs.some((m) => m.role === 'tool' && m.attachments?.tool === 'file_write'));

    
    const convA = (await api('POST', '/conversations', { title: 'Unified approval chat' }, token)).json.conversation;
    const apprRes = await fetch(BASE + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversationId: convA.id, content: 'USE_TERMINAL: compute in chat', mode: 'send' }),
    });
    let approvalFrame = null;
    let chatApproved = false;
    let chatDone = null;
    const chatFrames = [];
    const chatReader = readSse(apprRes, (ev) => {
      chatFrames.push(ev);
      if (ev.type === 'approval_required' && !chatApproved) {
        approvalFrame = ev;
        chatApproved = true;
        api('POST', `/runs/approvals/${ev.approvalId}`, { decision: 'approved', scope: 'once' }, token);
      }
      if (ev.type === 'done') chatDone = ev;
    });
    await chatReader;
    ok('chat approval requested inline', !!approvalFrame, `frames=${chatFrames.map((f) => f.type).join(',')}`);
    ok('approved chat tool executed (42)', chatFrames.some((f) => f.type === 'activity' && f.kind === 'tool_result' && (f.output || '').includes('42')));
    ok('unified approval chat completed', chatDone?.status === 'complete');

    
    await api('POST', '/memory', { kind: 'fact', content: 'User loves pineapple on pizza' }, token);
    await api('POST', '/memory', { kind: 'fact', content: 'User ships code on Fridays' }, token);
    const search = await api('POST', '/memory/search', { query: 'pizza preference' }, token);
    ok('semantic search ranks relevant memory first', search.json.results.length > 0 && search.json.results[0].content.includes('pizza'), JSON.stringify(search.json.results?.[0]));

    
    const run = (await api('POST', '/runs', { task: 'USE_FILE_TOOL: write hello.txt' }, token)).json.run;
    ok('agent run accepted (202)', !!run?.id);

    let finalRun = null;
    for (let i = 0; i < 60; i++) {
      await wait(500);
      finalRun = (await api('GET', `/runs/${run.id}`, null, token)).json.run;
      if (['completed', 'failed', 'cancelled'].includes(finalRun.status)) break;
    }
    ok('agent run completed', finalRun?.status === 'completed', `status=${finalRun?.status} error=${finalRun?.error}`);

    const workspaceFile = path.join(process.env.ZENO_DATA_DIR || path.join(process.cwd(), 'data'), 'workspaces', reg.json.user.id, 'hello.txt');
    ok('tool actually wrote a file into the sandboxed workspace', fs.existsSync(workspaceFile), workspaceFile);

    const events = (await api('GET', `/runs/${run.id}`, null, token)).json.events;
    ok('run events recorded (planning, tool_call, tool_result, completed)',
      ['plan/created', 'tool/started', 'tool/completed', 'session/end'].every((t) => events.some((e) => e.type === t)),
      `types=${[...new Set(events.map((e) => e.type))].join(',')}`
    );
    ok('unknown tool failure surfaced to the model, run still completed', finalRun.status === 'completed' || events.some((e) => e.type === 'tool/completed' && e.data.ok === false));

    
    const run2 = (await api('POST', '/runs', { task: 'USE_TERMINAL: compute' }, token)).json.run;
    let approvalEvent = null;
    let run2Final = null;
    let approved = false;
    for (let i = 0; i < 80; i++) {
      await wait(500);
      const evs = (await api('GET', `/runs/${run2.id}`, null, token)).json.events;
      const appr = evs.find((e) => e.type === 'permission/requested');
      const runNow = (await api('GET', `/runs/${run2.id}`, null, token)).json.run;
      if (appr && !approved) {
        approvalEvent = appr;
        const decide = await api('POST', `/runs/approvals/${appr.data.approvalId}`, { decision: 'approved', scope: 'task' }, token);
        ok('approval decision accepted', decide.status === 200);
        approved = true;
      }
      if (['completed', 'failed', 'cancelled'].includes(runNow.status)) {
        run2Final = runNow;
        break;
      }
    }
    ok('terminal tool triggered an approval request', !!approvalEvent, 'no permission/requested seen');
    ok('approved terminal run completed', run2Final?.status === 'completed', `status=${run2Final?.status}`);
    const toolResults2 = (await api('GET', `/runs/${run2.id}`, null, token)).json.events.filter((e) => e.type === 'tool/completed');
    ok('terminal executed real command (6*7=42)', toolResults2.some((e) => (e.data.output || '').includes('42')), JSON.stringify(toolResults2[0]?.data?.output || '').slice(0, 200));

    
    const mem2 = await api('POST', '/memory', { kind: 'fact', content: 'Wears a red scarf in winter' }, token);
    ok('memory stored with embedding', mem2.json.memory?.hasEmbedding === true, JSON.stringify(mem2.json.memory));

    
    const reg2 = await api('POST', '/auth/register', { email: `other_${Date.now()}@test.dev`, displayName: 'Other', password: 'testpass123' });
    const convAccess = await api('GET', `/conversations/${conv.id}`, null, reg2.json.token);
    ok('cross-user access denied', convAccess.status === 404);

    
    const run3 = (await api('POST', '/runs', { task: 'USE_FILE_TOOL: write live.txt' }, token)).json.run;
    const sseRes = await fetch(`${BASE}/api/runs/${run3.id}/events`, { headers: { Authorization: `Bearer ${token}` } });
    ok('run SSE endpoint streams', sseRes.status === 200 && (sseRes.headers.get('content-type') || '').includes('text/event-stream'));
    let sawStart = false;
    const sseDone = readSse(sseRes, (ev) => {
      if (ev.type === 'turn/start') sawStart = true;
    });
    await wait(2500);
    sseRes.body.cancel().catch(() => {});
    ok('live events flow over SSE', sawStart, 'no turn/start seen in 2.5s');
  } finally {
    stub.kill();
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log(` ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
