import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');


(function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

function intEnv(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: intEnv('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',

  // Secret for key encryption + token signing. In development we derive a
  // stable fallback so restarts don't invalidate stored keys; production must
  
  secret:
    process.env.ZENO_SECRET ||
    crypto.createHash('sha256').update(`zeno-dev-secret::${ROOT_DIR}`).digest('base64url'),

  corsOrigins: (process.env.ZENO_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: process.env.DATABASE_URL || null,
  redisUrl: process.env.REDIS_URL || null,

  dataDir: path.resolve(ROOT_DIR, process.env.ZENO_DATA_DIR || './data'),
  filesDir: path.resolve(ROOT_DIR, process.env.ZENO_DATA_DIR || './data', 'files'),
  workspacesDir: path.resolve(ROOT_DIR, process.env.ZENO_DATA_DIR || './data', 'workspaces'),

  sandboxUrl: process.env.ZENO_SANDBOX_URL || null,

  
  
  
  localBridge: {
    enabled: process.env.ZENO_LOCAL_BRIDGE === '1' || !!process.env.ZENO_LOCAL_ROOTS,
    roots: (process.env.ZENO_LOCAL_ROOTS || '')
      .split(process.platform === 'win32' ? ';' : ',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxReadBytes: intEnv('ZENO_LOCAL_MAX_READ_MB', 4) * 1024 * 1024,
    maxWriteBytes: intEnv('ZENO_LOCAL_MAX_WRITE_MB', 4) * 1024 * 1024,
  },

  tavilyKey: process.env.TAVILY_API_KEY || null,
  braveKey: process.env.BRAVE_API_KEY || null,

  auth: {
    sessionTtlMs: intEnv('ZENO_SESSION_TTL_DAYS', 30) * 24 * 3600 * 1000,
    maxSessionsPerUser: 20,
  },

  limits: {
    maxUploadBytes: intEnv('ZENO_MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxMessagesPerConversation: 2000,
    maxConversations: 500,
    maxFileUploads: 2000,
    maxProviders: 50,
    maxAgents: 100,
    rateLimit: { windowMs: 60_000, max: intEnv('ZENO_RATE_LIMIT', 240) },
    authRateLimit: { windowMs: 15 * 60_000, max: intEnv('ZENO_AUTH_RATE_LIMIT', 30) },
  },

  agent: {
    maxSteps: intEnv('ZENO_AGENT_MAX_STEPS', 40),
    stepTimeoutMs: intEnv('ZENO_AGENT_STEP_TIMEOUT_MS', 180_000),
    approvalTimeoutMs: intEnv('ZENO_AGENT_APPROVAL_TIMEOUT_MS', 30 * 60_000),
    toolTimeoutMs: intEnv('ZENO_TOOL_TIMEOUT_MS', 120_000),
    maxToolOutputChars: 24_000,
    contextCharBudget: intEnv('ZENO_CONTEXT_CHAR_BUDGET', 96_000),
  },

  
  
  
  intelligence: {
    
    
    
    remoteDecisionTimeoutMs: intEnv('ZENO_DECISION_TIMEOUT_MS', 2500),
    
    modelRetryAttempts: intEnv('ZENO_MODEL_RETRY_ATTEMPTS', 2),
    modelRetryBaseDelayMs: intEnv('ZENO_MODEL_RETRY_BASE_MS', 500),
    modelRetryMaxDelayMs: intEnv('ZENO_MODEL_RETRY_MAX_MS', 8000),
    
    
    researchMaxSubqueries: intEnv('ZENO_RESEARCH_MAX_SUBQUERIES', 4),
    researchMaxReads: intEnv('ZENO_RESEARCH_MAX_READS', 3),
    
    maxParallelTools: intEnv('ZENO_MAX_PARALLEL_TOOLS', 6),
  },

  workers: {
    concurrency: intEnv('ZENO_WORKER_CONCURRENCY', 4),
    pollMs: 1000,
  },
};

export function ensureDataDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.filesDir, { recursive: true });
  fs.mkdirSync(config.workspacesDir, { recursive: true });
}
