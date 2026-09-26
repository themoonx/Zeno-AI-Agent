

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, ensureDataDirs } from './core/config.js';
import { logger } from './core/logger.js';
import { AppError, errors } from './core/errors.js';
import { rateLimit, clientIp } from './core/ratelimit.js';
import { initDatabase } from './database/index.js';
import { createAuthService } from './auth/auth.service.js';
import { createAuthMiddleware } from './auth/middleware.js';
import { createAuthRoutes } from './auth/auth.routes.js';
import { createGateway } from './providers/gateway.js';
import { createMemoryService } from './services/memory.service.js';
import { projectSessionMemory } from './services/memory/projections.js';
import { createAgentRuntime } from './agents/runtime.js';
import { createApprovalGate } from './agents/approvals.js';
import { createOrchestrator } from './agent/orchestrator.js';
import { createCapabilityExecutor } from './capabilities/executor.js';
import { createCodeOrchestrateTool } from './capabilities/code-mode.js';
import { createPolicyEngine } from './policy/engine.js';
import { createPolicyReevaluator } from './policy/reevaluate.js';
import { createPromptRegistry } from './agent/prompt.js';
import { registerDefaultPromptContributors } from './agent/context.js';
import { createSubagentRunner, createDelegateTool } from './agent/subagents.js';
import { createReviewer } from './agent/reviewer.js';
import { createRuntimeControl } from './agent/control.js';
import { createDecisionEngine } from './decision/engine.js';
import { createModelRouter } from './routing/model-router.js';
import { createCostGovernor } from './routing/cost.js';
import { createVerificationEngine } from './agent/verification.js';
import { createWorkerLoop } from './workers/worker.js';
import { registerJobProcessors, enqueueAgentRun, enqueueMemoryExtraction } from './workers/jobs.js';
import { allToolDescriptors, registerTool, sandboxMode } from './tools/registry.js';
import { createSkillLoadTool } from './tools/skill-load.js';
import { createSessionKernel } from './kernel/log.js';
import { importLegacyHistory } from './kernel/import.js';
import { createRpcHandler } from './kernel/rpc.js';
import { getSnapshots } from './snapshots/service.js';
import { createTelemetry } from './observability/index.js';
import { createScheduler } from './scheduler/index.js';
import { attachAgentGateway } from './realtime/gateway.js';

import { createProviderRoutes } from './api/providers.routes.js';
import { createConversationRoutes } from './api/conversations.routes.js';
import { createProjectRoutes, createAgentRoutes } from './api/projects.routes.js';
import { createRunRoutes } from './api/runs.routes.js';
import { createFileRoutes } from './api/files.routes.js';
import { createMemoryRoutes, createSettingsRoutes } from './api/memory.routes.js';
import { createChatRoutes } from './api/chat.routes.js';
import { createConnectorRoutes } from './api/connectors.routes.js';
import { createControlRoutes } from './api/control.routes.js';
import { createRpcRoute } from './api/rpc.routes.js';
import { createScheduleRoutes } from './api/schedules.routes.js';
import { createDecisionRoutes } from './api/decision.routes.js';
import { createConnectorService } from './connectors/service.js';
import { createHarness } from './harness/index.js';
import { createHarnessRoutes } from './api/harness.routes.js';

const log = logger('server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  ensureDataDirs();
  const { repos } = await initDatabase();

  const audit = (entry) => {
    try {
      repos.ops.audit(entry);
    } catch {
      
    }
  };

  const auth = createAuthService({ repos, audit });
  const { requireAuth, optionalAuth } = createAuthMiddleware(auth);
  const gateway = createGateway({ repos });
  
  
  
  const memory = createMemoryService({ repos, gateway });
  const approvals = createApprovalGate({ repos });
  
  const kernel = createSessionKernel({ repos });
  const telemetry = createTelemetry({ repos });
  const snapshots = getSnapshots(repos, telemetry);
  const connectors = createConnectorService({ repos, audit });
  
  const policy = createPolicyEngine({ repos });
  
  
  const harness = createHarness({ repos, connectors, audit, policy });
  
  const promptRegistry = createPromptRegistry();
  registerDefaultPromptContributors(promptRegistry);
  
  registerTool(createSkillLoadTool({ harness }));
  
  const executor = createCapabilityExecutor({ repos, approvals, audit, policy, snapshots, telemetry });
  
  
  const decision = createDecisionEngine({ repos });
  const modelRouter = createModelRouter({ repos, decision });
  const costGovernor = createCostGovernor({ repos });
  const verification = createVerificationEngine({ repos, gateway, modelRouter });
  const orchestrator = createOrchestrator({ repos, gateway, memory, approvals, audit, harness, executor, policy, kernel, promptRegistry, telemetry, decision, modelRouter, costGovernor, verification });
  const subagents = createSubagentRunner({ repos, kernel, orchestrator, telemetry });
  registerTool(createDelegateTool({ subagents, repos, kernel }));
  registerTool(createCodeOrchestrateTool({ repos, executor }));
  const reviewer = createReviewer({ repos, kernel, orchestrator, snapshots });
  const runtime = createAgentRuntime({ repos, orchestrator, audit, memory, kernel, reviewer, snapshots });
  const runtimeControl = createRuntimeControl({ repos, kernel });
  const policyReevaluator = createPolicyReevaluator({ repos, policy });
  const rpcDeps = { runsService: null };
  const rpcHandler = createRpcHandler({ repos, kernel, deps: rpcDeps, runtimeControl, snapshots, memory });

  const runsService = {
    startRun: async ({ userId, agent, task }) => {
      const run = await runtime.startRun({ userId, agent, task });
      enqueueAgentRun({ repos }, run.id, userId);
      return run;
    },
  };
  rpcDeps.runsService = runsService;

  
  importLegacyHistory({ repos, kernel, log });

  registerJobProcessors({ repos, runtime, memory, kernel });
  const worker = createWorkerLoop({ repos, telemetry });
  worker.start();

  
  const scheduler = createScheduler({ repos, kernel, runsService, telemetry, audit });
  scheduler.start();
  
  setInterval(() => {
    try {
      repos.ops.requeueStale?.();
    } catch {  }
  }, 5 * 60_000).unref?.();

  const generalLimiter = rateLimit({ ...config.limits.rateLimit, keyFn: (req) => `${req.auth?.userId || 'anon'}:${clientIp(req)}` });
  const authLimiter = rateLimit({ ...config.limits.authRateLimit, keyFn: (req) => `auth:${clientIp(req)}` });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; ')
    );
    if (config.corsOrigins.length) {
      const origin = req.headers.origin;
      if (config.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      }
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  
  app.use(optionalAuth);

  
  const api = express.Router();
  api.get('/health', (req, res) => {
    res.json({
      ok: true,
      name: 'Zeno AI',
      version: '1.0.0',
      database: app.locals.dbKind || 'unknown',
      sandbox: sandboxMode(),
      time: new Date().toISOString(),
    });
  });

  api.use('/auth', authLimiter, createAuthRoutes({ auth, rateLimiter: (req, res, next) => next() }));
  api.use('/providers', requireAuth, createProviderRoutes({ repos, gateway, audit, config }));
  api.use('/conversations', requireAuth, createConversationRoutes({ repos, config }));
  api.use('/projects', requireAuth, createProjectRoutes({ repos }));
  api.use('/agents', requireAuth, createAgentRoutes({ repos, runs: runsService }));
  api.use('/runs', requireAuth, createRunRoutes({ repos, runs: runsService, toolSchemas: allToolDescriptors, sandboxMode, policy, runtimeControl, kernel, policyReevaluator }));
  api.use('/files', requireAuth, createFileRoutes({ repos }));
  api.use('/memory', requireAuth, createMemoryRoutes({ repos, memory }));
  api.use('/settings', requireAuth, createSettingsRoutes({ repos, audit }));
  api.use('/chat', requireAuth, createChatRoutes({ repos, gateway, memory, orchestrator, kernel, snapshots, enqueueMemoryExtraction: (convId, userId) => enqueueMemoryExtraction({ repos }, convId, userId) }));
  api.use('/connectors', requireAuth, createConnectorRoutes({ connectors }));
  api.use('/harness', requireAuth, createHarnessRoutes({ repos, harness, audit }));
  api.use('/control', requireAuth, createControlRoutes({ repos, audit, policy, runtimeControl, snapshots, policyReevaluator, telemetry }));
  api.use('/schedules', requireAuth, createScheduleRoutes({ repos, runs: runsService, audit }));
  api.use('/rpc', requireAuth, createRpcRoute({ rpcHandler }));
  const { decisionRouter, costRouter } = createDecisionRoutes({ repos, decision, modelRouter, costGovernor });
  api.use('/decision', requireAuth, decisionRouter);
  api.use('/cost', requireAuth, costRouter);

  app.use('/api', generalLimiter, api);

  
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } });
  });

  
  app.use('/api', (err, req, res, next) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log.error(err.message, err);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: { code: 'bad_json', message: 'Invalid JSON body' } });
    }
    log.error('Unhandled API error', err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  
  const frontendDir = path.resolve(__dirname, '..', 'frontend');
  app.use(
    express.static(frontendDir, {
      index: 'index.html',
      maxAge: config.env === 'production' ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res) => {
    
    
    
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    const indexFile = path.join(frontendDir, 'index.html');
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res.status(503).send('Frontend not built. See README.');
  });

  app.locals.dbKind = (await import('./database/index.js')).db?.kind || 'unknown';
  const server = app.listen(config.port, config.host, () => {
    log.info(`Zeno AI listening on http://${config.host}:${config.port} (db=${app.locals.dbKind}, sandbox=${sandboxMode()})`);
  });

  
  attachAgentGateway({ server, repos, config });

  const shutdown = () => {
    log.info('Shutting down…');
    worker.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal boot error', err);
  process.exit(1);
});
