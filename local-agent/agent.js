#!/usr/bin/env node


















import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { WebSocket } from 'ws';


function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = argv[++i];
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--roots') out.roots = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--allow-shell') out.allowShell = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help || !args.server || !args.token) {
  console.log(`Zeno Local Agent

Usage:
  node local-agent/agent.js --server <zeno-url> --token <pairing-token> --roots "<dir>;<dir>" [--allow-shell] [--name <name>]

Get a pairing token in Zeno → Settings → Environments → Pair local agent.`);
  process.exit(args.help ? 0 : 1);
}

const SERVER = String(args.server).replace(/\/+$/, '');
const TOKEN = String(args.token);
const ROOTS = String(args.roots || '')
  .split(process.platform === 'win32' ? ';' : ',')
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => path.resolve(r));
if (!ROOTS.length) {
  console.error('No roots configured. Pass --roots "C:\\path1;C:\\path2" — the daemon exposes nothing without roots.');
  process.exit(1);
}
const ALLOW_SHELL = !!args.allowShell;
const MAX_BYTES = 8 * 1024 * 1024;

console.log(`Zeno Local Agent`);
console.log(`  server: ${SERVER}`);
console.log(`  roots:  ${ROOTS.join('  ')}`);
console.log(`  shell:  ${ALLOW_SHELL ? 'enabled (--allow-shell)' : 'disabled (fs-only)'}`);


function norm(p) {
  const r = path.resolve(String(p || ''));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
function resolveWithinRoots(raw) {
  const wanted = path.resolve(String(raw || ''));
  const wn = norm(wanted);
  const hit = ROOTS.find((r) => {
    const rn = norm(r);
    return wn === rn || wn.startsWith(rn + path.sep);
  });
  if (!hit) throw new Error(`Path outside authorized roots: ${wanted}`);
  return { target: wanted, root: hit };
}

function clip(s) {
  const t = String(s ?? '');
  return t.length > 16_000 ? { content: t.slice(0, 16_000), truncated: true } : { content: t, truncated: false };
}

async function readText(target) {
  const st = await fs.stat(target);
  if (st.isDirectory()) throw new Error('Path is a directory');
  if (st.size > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES} bytes`);
  const buf = await fs.readFile(target);
  if (buf.subarray(0, 8192).includes(0)) throw new Error('Binary file — not readable via text tools');
  return { stat: st, text: buf.toString('utf8') };
}


async function runOp(op, params = {}) {
  switch (op) {
    case 'fs.read': {
      const { target } = resolveWithinRoots(params.path);
      const { stat, text } = await readText(target);
      return { ok: true, path: target, size: stat.size, content: text, truncated: false };
    }
    case 'fs.list': {
      const { target, root } = resolveWithinRoots(params.path);
      const entries = [];
      const rel = (p) => (params.recursive ? path.relative(root, p) || path.basename(p) : path.basename(p));
      if (params.recursive) {
        const stack = [target];
        while (stack.length && entries.length < 500) {
          const dir = stack.pop();
          for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              stack.push(full);
              entries.push({ path: rel(full), type: 'dir' });
            } else {
              const st = await fs.stat(full).catch(() => null);
              entries.push({ path: rel(full), type: 'file', size: st?.size ?? null });
            }
          }
        }
      } else {
        for (const ent of await fs.readdir(target, { withFileTypes: true })) {
          entries.push({ path: ent.name, type: ent.isDirectory() ? 'dir' : 'file' });
        }
      }
      return { ok: true, path: target, entries };
    }
    case 'fs.write': {
      const { target, root } = resolveWithinRoots(params.path);
      if (norm(target) === norm(root)) throw new Error('Refusing to overwrite an authorized root');
      const body = String(params.content ?? '');
      if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw new Error(`Content exceeds ${MAX_BYTES} bytes`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const existed = await fs.stat(target).then(() => true).catch(() => false);
      await fs.writeFile(target, body, 'utf8');
      const st = await fs.stat(target);
      return { ok: true, path: target, bytesWritten: st.size, created: !existed, preview: clip(body) };
    }
    case 'fs.edit': {
      const { target, root } = resolveWithinRoots(params.path);
      if (norm(target) === norm(root)) throw new Error('Refusing to edit an authorized root');
      const { stat, text } = await readText(target);
      const find = String(params.find ?? '');
      const replace = String(params.replace ?? '');
      if (!find) throw new Error('find must not be empty');
      const occurrences = text.split(find).length - 1;
      if (occurrences === 0) throw new Error('Snippet not found in file — nothing was changed');
      if (occurrences > 1 && !params.replace_all) {
        throw new Error(`Snippet matches ${occurrences} times; pass replace_all or include more context`);
      }
      const updated = params.replace_all ? text.split(find).join(replace) : text.replace(find, () => replace);
      await fs.writeFile(target, updated, 'utf8');
      return { ok: true, path: target, replacements: params.replace_all ? occurrences : 1, size: stat.size, preview: clip(updated) };
    }
    case 'fs.delete': {
      const { target, root } = resolveWithinRoots(params.path);
      if (norm(target) === norm(root)) throw new Error('Refusing to delete an authorized root');
      const st = await fs.stat(target);
      if (st.isDirectory()) throw new Error('Refusing to delete a directory');
      await fs.unlink(target);
      return { ok: true, path: target, deleted: true };
    }
    case 'shell.exec': {
      if (!ALLOW_SHELL) throw new Error('Shell execution is disabled on this agent (start without --allow-shell to keep it off).');
      const { spawn } = await import('node:child_process');
      const command = String(params.command || '').trim();
      if (!command) throw new Error('command is required');
      const parts = tokenize(command);
      const [cmd, ...rest] = parts;
      const out = await execChild(spawn, cmd, rest, { cwd: ROOTS[0], timeoutMs: 120_000 });
      return { ok: out.exitCode === 0, ...out };
    }
    case 'code.exec': {
      if (!ALLOW_SHELL) throw new Error('Code execution is disabled on this agent (start without --allow-shell to keep it off).');
      const { spawn } = await import('node:child_process');
      const language = params.language === 'node' ? 'node' : 'python';
      const code = String(params.code || '');
      if (!code.trim()) throw new Error('code is required');
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `zeno-agent-${language}-`));
      const file = path.join(tmp, language === 'python' ? 'main.py' : 'main.js');
      await fs.writeFile(file, code, 'utf8');
      const runner = language === 'python' ? (process.env.ZENO_PYTHON || 'python') : 'node';
      const out = await execChild(spawn, runner, [file], { cwd: ROOTS[0], timeoutMs: 120_000 });
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      return { ok: out.exitCode === 0, ...out };
    }
    default:
      throw new Error(`Unknown op: ${op}`);
  }
}

function tokenize(input) {
  const args = [];
  let cur = '';
  let quote = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) args.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

function execChild(spawn, cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (stdout.length < 48_000) stdout += d.toString();
      else truncated = true;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 8_000) stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err.message), exitCode: -1, truncated });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1, truncated });
    });
  });
}


let backoff = 1000;

function connect() {
  const wsUrl = SERVER.replace(/^http/, 'ws') + '/api/agent-ws';
  console.log(`connecting to ${wsUrl} …`);
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    backoff = 1000;
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      console.log(`paired ✔  serving roots: ${ROOTS.join(', ')}`);
      return;
    }
    if (msg.type === 'op') {
      let result;
      let ok = true;
      let error = null;
      try {
        result = await runOp(msg.op, msg.params);
      } catch (err) {
        ok = false;
        error = err.message;
      }
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'result', id: msg.id, ok, ...(ok ? { result } : { error }) }));
      }
    }
  });

  ws.on('close', (code) => {
    if (code === 4003) {
      console.error('Pairing token was rejected or revoked. Create a new one in Settings → Environments.');
      process.exit(1);
    }
    console.log(`disconnected (code ${code}); retrying in ${Math.round(backoff / 1000)}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });

  ws.on('error', (err) => {
    console.error(`connection error: ${err.message}`);
  });

  const heartbeat = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }));
  }, 15_000);
  ws.on('close', () => clearInterval(heartbeat));
}

connect();

process.on('SIGINT', () => {
  console.log('\nshutting down');
  process.exit(0);
});
