import { spawn } from 'node:child_process';
import path from 'node:path';

const port = '3199';
const env = {
  ...process.env,
  PORT: port,
  DATABASE_URL: '',
  ZENO_DATA_DIR: path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', `connectors-smoke-${Date.now()}`),
  ZENO_AGENT_APPROVAL_TIMEOUT_MS: '5000',
};
const server = spawn(process.execPath, ['backend/server.js'], { env, stdio: 'inherit' });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${server.exitCode}`);
    try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Server readiness timeout');
  const test = spawn(process.execPath, ['scripts/smoke.js'], {
    env: { ...env, SMOKE_BASE: `http://127.0.0.1:${port}` }, stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve) => test.on('exit', resolve));
} finally {
  server.kill();
}
