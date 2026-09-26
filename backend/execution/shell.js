








import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

const log = logger('shell');
const MAX_OUTPUT = config.agent.maxToolOutputChars;

function clampOutput(stdout, stderr, exitCode, truncated) {
  return {
    stdout: stdout.length > MAX_OUTPUT ? stdout.slice(0, MAX_OUTPUT) + '\n[stdout truncated]' : stdout,
    stderr: stderr.length > 4000 ? stderr.slice(0, 4000) + '\n[stderr truncated]' : stderr,
    exitCode,
    truncated,
  };
}

async function runInDockerSandbox(payload) {
  
  
  
  const res = await fetch(new URL('/exec', config.sandboxUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.agent.toolTimeoutMs),
  });
  if (!res.ok) throw new Error(`Sandbox service returned ${res.status}`);
  const data = await res.json();
  return clampOutput(String(data.stdout || ''), String(data.stderr || ''), data.exit_code ?? 0, false);
}

function localExec(cmd, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT * 2) stdout += d.toString();
      else truncated = true;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 8000) stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(clampOutput(stdout, stderr + (stderr ? '\n' : '') + String(err.message), -1, truncated));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(clampOutput(stdout, stderr, code ?? -1, truncated));
    });
  });
}


function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LANG: 'C.UTF-8',
    ...extra,
  };
}



export function parseCommand(input) {
  const args = [];
  let current = '';
  let quote = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) args.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}


export function sandboxMode() {
  return config.sandboxUrl ? 'docker' : 'local-restricted';
}


export async function execCommand(command, { runId, cwd } = {}) {
  const cmdLine = String(command || '').trim();
  if (!cmdLine) throw new Error('command is required');

  if (config.sandboxUrl) {
    return runInDockerSandbox({ task_id: runId, cmd: cmdLine, workdir: '.' });
  }

  
  const parts = parseCommand(cmdLine);
  if (!parts.length) throw new Error('Empty command');
  const [cmd, ...rest] = parts;
  const out = await localExec(cmd, rest, {
    cwd,
    timeoutMs: config.agent.toolTimeoutMs,
    env: baseEnv(cwd ? { ZENO_WORKSPACE: cwd } : {}),
  });
  if (out.exitCode === -1 && /ENOENT/i.test(out.stderr)) {
    throw new Error(`Command not found: ${cmd}`);
  }
  log.debug(`exec (local) exit=${out.exitCode} run=${runId}`);
  return out;
}


export async function execCode(code, language = 'python', { runId, cwd } = {}) {
  const lang = language === 'node' ? 'node' : 'python';
  const body = String(code || '');
  if (!body.trim()) throw new Error('code is required');

  if (config.sandboxUrl) {
    return runInDockerSandbox({ task_id: runId, code: body, language: lang, workdir: '.' });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `zeno-exec-${lang}-`));
  const file = path.join(tmpDir, lang === 'python' ? 'main.py' : 'main.js');
  await fs.writeFile(file, body, 'utf8');
  const runner = lang === 'python' ? process.env.ZENO_PYTHON || 'python' : 'node';
  const out = await localExec(runner, [file], {
    cwd,
    timeoutMs: config.agent.toolTimeoutMs,
    env: baseEnv({ ZENO_WORKSPACE: cwd || '', PYTHONIOENCODING: 'utf-8' }),
  });
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  log.debug(`code_exec (local) exit=${out.exitCode} run=${runId}`);
  return out;
}
