





import { errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { randomId } from '../core/crypto.js';
import { nextRun } from '../scheduler/cron.js';

const log = logger('rpc');

export function createRpcHandler({ repos, kernel, deps, runtimeControl, snapshots, memory }) {
  
  
  const getRunsService = () => {
    if (!deps?.runsService) throw errors.internal('runs service not ready');
    return deps.runsService;
  };
  const methods = {
    
    'session.start': async ({ userId, params }) => {
      const session = kernel.create({ userId, kind: 'chat', conversationId: params.conversationId || null });
      return { sessionId: session.id, status: session.status };
    },
    'session.events': async ({ userId, params }) => {
      const session = repos.sessions.get(params.sessionId);
      if (!session || session.userId !== userId) throw errors.notFound('Session');
      const events = kernel.replay(params.sessionId, { afterSeq: Number(params.afterSeq) || 0 });
      return { sessionId: params.sessionId, events, lastSeq: events.length ? events[events.length - 1].seq : Number(params.afterSeq) || 0 };
    },
    'session.status': async ({ userId, params }) => {
      const session = repos.sessions.get(params.sessionId);
      if (!session || session.userId !== userId) throw errors.notFound('Session');
      return { sessionId: session.id, kind: session.kind, status: session.status, conversationId: session.conversationId };
    },
    'session.stop': async ({ userId, params }) => runtimeControl.stop({ userId, sessionId: params.sessionId }),
    'session.abort': async ({ userId, params }) => runtimeControl.abort({ userId, sessionId: params.sessionId }),

    
    'run.start': async ({ userId, params }) => {
      if (!params.task) throw errors.badRequest('task is required');
      const run = await getRunsService().startRun({ userId, agent: { name: params.agentName || 'Headless run', projectId: params.projectId || null }, task: String(params.task).slice(0, 8000) });
      return { runId: run.id, status: run.status };
    },
    'run.status': async ({ userId, params }) => {
      const run = repos.runs.getRun(userId, params.runId);
      if (!run) throw errors.notFound('Run');
      const session = repos.sessions.activeForRun(run.id);
      const events = session ? kernel.replay(session.id).slice(-200) : [];
      return { runId: run.id, status: run.status, result: run.result, error: run.error, stats: run.stats, events };
    },
    'run.cancel': async ({ userId, params }) => {
      repos.runs.requestCancel(userId, params.runId);
      return { ok: true };
    },

    
    'approval.pending': async ({ userId }) => ({ approvals: repos.runs.listPendingApprovals(userId) }),
    'approval.decide': async ({ userId, params }) => {
      const approval = repos.runs.getApproval(userId, params.approvalId);
      if (!approval) throw errors.notFound('Approval');
      repos.runs.decideApproval(userId, params.approvalId, params.decision, params.scope || 'once');
      return { ok: true };
    },

    
    'snapshot.stack': async ({ userId, params }) => {
      const session = repos.sessions.get(params.sessionId);
      if (!session || session.userId !== userId) throw errors.notFound('Session');
      return { sessionId: params.sessionId, ...snapshots.stackState(params.sessionId) };
    },
    'snapshot.undo': async ({ userId, params }) => snapshots.undo(userId, params.sessionId),
    'snapshot.redo': async ({ userId, params }) => snapshots.redo(userId, params.sessionId),
    'snapshot.restore': async ({ userId, params }) => ({ ...(await snapshots.restore(userId, params.snapshotId)) }),

    
    'schedule.list': async ({ userId }) => ({ schedules: repos.schedules.list(userId) }),
    'schedule.create': async ({ userId, params }) => {
      if (!params.name || !params.cron || !params.task) throw errors.badRequest('name, cron and task are required');
      let nextRunAt;
      try {
        nextRunAt = nextRun(params.cron, new Date());
      } catch (err) {
        throw errors.badRequest(`Invalid cron expression: ${err.message}`);
      }
      const schedule = repos.schedules.create({
        id: randomId('sched'),
        userId,
        name: String(params.name).slice(0, 120),
        cron: params.cron,
        task: String(params.task).slice(0, 8000),
        projectId: params.projectId || null,
        maxConcurrent: Number(params.maxConcurrent) || 1,
        maxRetries: Number(params.maxRetries) || 2,
        nextRunAt,
      });
      return { schedule };
    },
    'schedule.update': async ({ userId, params }) => {
      const existing = repos.schedules.get(userId, params.scheduleId);
      if (!existing) throw errors.notFound('Schedule');
      const fields = {};
      for (const k of ['name', 'cron', 'task', 'enabled', 'projectId', 'modelId', 'maxConcurrent', 'maxRetries']) {
        if (params[k] !== undefined) fields[k] = params[k];
      }
      if (fields.cron && fields.cron !== existing.cron) {
        try {
          fields.nextRunAt = nextRun(fields.cron, new Date());
        } catch (err) {
          throw errors.badRequest(`Invalid cron expression: ${err.message}`);
        }
      }
      repos.schedules.update(userId, params.scheduleId, fields);
      return { schedule: repos.schedules.get(userId, params.scheduleId) };
    },
    'schedule.trigger': async ({ userId, params }) => {
      const schedule = repos.schedules.get(userId, params.scheduleId);
      if (!schedule) throw errors.notFound('Schedule');
      const run = await getRunsService().startRun({ userId, agent: { name: `Schedule: ${schedule.name}`, projectId: schedule.projectId }, task: schedule.task });
      return { runId: run.id, status: run.status };
    },
    'schedule.remove': async ({ userId, params }) => {
      repos.schedules.delete(userId, params.scheduleId);
      return { ok: true };
    },

    
    'memory.search': async ({ userId, params }) => {
      const results = await memory.semanticSearch(userId, String(params.query || ''), { limit: params.limit || 8 });
      return { results: results.map((r) => ({ content: r.content, kind: r.kind, score: Number(r.score.toFixed(3)) })) };
    },
  };

  
  async function handle(request, authUser) {
    const response = { jsonrpc: '2.0', id: request?.id ?? null };
    try {
      const method = methods[request?.method];
      if (!method) {
        response.error = { code: -32601, message: `Method not found: ${request?.method}` };
        return response;
      }
      if (!authUser) {
        response.error = { code: -32000, message: 'Authentication required' };
        return response;
      }
      const result = await method({ userId: authUser.userId, user: authUser.user, params: request.params || {} });
      response.result = result;
      return response;
    } catch (err) {
      log.warn(`rpc ${request?.method} failed: ${err.message}`);
      response.error = { code: err.status === 404 ? -32001 : -32000, message: err.message };
      return response;
    }
  }

  return { handle, methods: Object.keys(methods) };
}