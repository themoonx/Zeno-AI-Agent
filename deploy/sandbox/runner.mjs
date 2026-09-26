




import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8090);
const TIME_LIMIT_MS = Number(process.env.SANDBOX_TIME_LIMIT_MS || 60_000);
const MAX_OUTPUT = 60_000;
const HAS_DOCKER = fs.existsSync('/var/run/docker.sock');

function safeId(id) {
  return String(id || 'task').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'task';
}

function execContainer(taskId, image, args, workdir, cb) {
  const dockerArgs = [
    'run', '--rm',
    '--network', 'none',
    '--cpus', '1',
    '--memory', '512m',
    '--pids-limit', '128',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=32m',
    '-v', `${workdir}:/workspace:rw`,
    '-w', '/workspace',
    '--label', `zeno-task=${taskId}`,
    image,
    ...args,
  ];
  const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, TIME_LIMIT_MS);
  child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT * 2) stdout += d; });
  child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
  child.on('error', (err) => { clearTimeout(timer); cb(null, null, err); });
  child.on('close', (code) => { clearTimeout(timer); cb(stdout, stderr, null, killed, code); });
}

function execLocal(cmdArgs, cwd, env, cb) {
  const child = spawn(cmdArgs[0], cmdArgs.slice(1), { cwd, env, shell: false });
  let stdout = '';
  let stderr = '';
  let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, TIME_LIMIT_MS);
  child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT * 2) stdout += d; });
  child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
  child.on('error', (err) => { clearTimeout(timer); cb(null, null, err); });
  child.on('close', (code) => { clearTimeout(timer); cb(stdout, stderr, null, killed, code); });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, backend: HAS_DOCKER ? 'docker' : 'local', host: os.hostname() }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/exec') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }
    const taskId = safeId(payload.task_id);
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `zeno-${taskId}-`));

    const finish = (stdout, stderr, err, killed, code) => {
      fs.rmSync(workdir, { recursive: true, force: true });
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stdout: '', stderr: String(err.message), exit_code: -1 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        stdout: (stdout || '') + (killed ? `\n[sandbox: killed after ${TIME_LIMIT_MS}ms]` : ''),
        stderr: stderr || '',
        exit_code: killed ? 124 : (code ?? 0),
      }));
    };

    if (payload.cmd) {
      
      const parts = String(payload.cmd).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      if (!parts.length) return finish('', 'empty command', null, false, 1);
      if (HAS_DOCKER) {
        execContainer(taskId, 'alpine:3.20', parts, workdir, finish);
      } else {
        console.warn(`[sandbox] docker unavailable — executing locally (restricted env): ${parts[0]}`);
        execLocal(parts, workdir, { PATH: process.env.PATH, HOME: workdir, TMPDIR: workdir }, finish);
      }
      return;
    }

    if (payload.code) {
      const language = payload.language === 'node' ? 'node' : 'python';
      const file = language === 'python' ? 'main.py' : 'main.js';
      fs.writeFileSync(path.join(workdir, file), String(payload.code));
      if (HAS_DOCKER) {
        const image = language === 'python' ? 'python:3.12-alpine' : 'node:24-alpine';
        execContainer(taskId, image, [language === 'python' ? 'python3' : 'node', file], workdir, finish);
      } else {
        const runner = language === 'python' ? 'python3' : 'node';
        execLocal([runner, path.join(workdir, file)], workdir, { PATH: process.env.PATH, HOME: workdir, TMPDIR: workdir }, finish);
      }
      return;
    }

    res.writeHead(400).end('provide cmd or code');
  });
});

server.listen(PORT, () => console.log(`zeno sandbox runner on :${PORT} (backend: ${HAS_DOCKER ? 'docker' : 'local'})`));
