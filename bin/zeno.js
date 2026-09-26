#!/usr/bin/env node










import process from 'node:process';

const SERVER = (process.env.ZENO_SERVER || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = process.env.ZENO_TOKEN || '';

let nextId = 1;
async function rpc(method, params = {}) {
  const res = await fetch(`${SERVER}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body = await res.json().catch(() => ({ error: { message: `invalid response (${res.status})` } }));
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function chat(task) {
  if (!TOKEN) {
    console.error('ZENO_TOKEN is required — set it to a session token (Settings → Security shows your sessions).');
    process.exit(1);
  }
  const { runId } = await rpc('run.start', { task, agentName: 'CLI' });
  console.error(`run ${runId} started`);
  let lastSeq = 0;
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await rpc('run.status', { runId });
    for (const ev of status.events || []) {
      if (ev.seq <= lastSeq) continue;
      lastSeq = ev.seq;
      const d = ev.data || {};
      if (ev.type === 'output/delta') process.stdout.write(d.text || '');
      else if (ev.type === 'tool/started') console.error(`\n→ ${d.displayName || d.tool}`);
      else if (ev.type === 'tool/completed') console.error(`  ${d.ok === false ? '✗' : '✓'} ${d.displayName || d.tool}${d.durationMs ? ` (${d.durationMs}ms)` : ''}`);
    }
    if (['completed', 'failed', 'cancelled'].includes(status.status)) {
      console.error(`\n[${status.status}]`);
      if (status.result) console.log(status.result);
      if (status.error) console.error(status.error);
      process.exit(status.status === 'completed' ? 0 : 1);
    }
  }
  console.error('Timed out waiting for the run.');
  process.exit(2);
}

async function runStatus(task) {
  const { runId } = await rpc('run.start', { task, agentName: 'CLI (detached)' });
  console.log(runId);
}

async function schedules() {
  const { schedules } = await rpc('schedule.list', {});
  for (const s of schedules) {
    console.log(`${s.enabled ? '●' : '○'} ${s.name}  [${s.cron}]  next: ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}  (${s.id})`);
  }
  if (!schedules.length) console.log('No schedules.');
}

const [cmd, ...rest] = process.argv.slice(2);
const task = rest.join(' ');
const handlers = { chat, run: runStatus, schedules };
if (!cmd || !handlers[cmd] || (['chat', 'run'].includes(cmd) && !task.trim())) {
  console.log(`Zeno CLI — headless access to the Agent Kernel.

Usage:
  ZENO_SERVER=<url> ZENO_TOKEN=<token> node bin/zeno.js <command> [args]

Commands:
  chat "<task>"     Run a task and stream the agent's work to the terminal.
  run "<task>"      Start a task detached; prints the run id.
  schedules         List scheduled tasks.`);
  process.exit(cmd && handlers[cmd] ? 1 : 0);
}

handlers[cmd](task).catch((err) => {
  console.error(err.message);
  process.exit(1);
});