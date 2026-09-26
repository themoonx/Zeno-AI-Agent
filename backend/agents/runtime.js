




import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { permissionMode as storedPermissionMode } from '../harness/permissions.js';
import { disposeSession } from '../kernel/lifecycle-registry.js';
import { publish, topics } from '../core/eventbus.js';

const log = logger('runtime');

export function createAgentRuntime({ repos, orchestrator, audit, memory, kernel, reviewer, snapshots, telemetry }) {
  
  async function startRun({ userId, agent, task }) {
    const runId = randomId('run');
    repos.runs.createRun({
      id: runId,
      userId,
      agentId: agent.id || null,
      agentName: agent.name || 'Ad-hoc agent',
      projectId: agent.projectId || null,
      task,
      kind: 'agent',
    });
    audit({ userId, action: 'agent.run.start', target: runId, meta: { agent: agent.name } });
    return repos.runs.getRun(userId, runId);
  }

  function defaultModelRowId(userId) {
    const setting = repos.users.getSetting(userId, 'default_model');
    if (setting?.modelId && repos.providers.getModel(userId, setting.modelId)) return setting.modelId;
    const models = repos.providers.listModels(userId);
    return models.length ? models[models.length - 1].id : null;
  }

  
  async function executeRun(runId) {
    const run = repos.runs.getRunRaw(runId);
    if (!run) return;
    const userId = run.userId;
    const agent = run.agentId ? repos.agents.getAgent(userId, run.agentId) : null;
    const task = run.task;

    const modelRowId = agent?.model?.modelId || defaultModelRowId(userId);
    if (!modelRowId) {
      repos.runs.updateRun(run.id, { status: 'failed', error: 'No model configured. Add a provider and pick a default model in Settings.', finishedAt: Date.now() });
      return;
    }

    let cancelled = false;
    const checkCancel = () => {
      const fresh = repos.runs.getRunRaw(run.id);
      if (fresh?.cancelRequested) {
        cancelled = true;
        return true;
      }
      return false;
    };

    
    const session = kernel.create({ userId, kind: 'task', runId: run.id, conversationId: run.conversationId, reuse: false });
    kernel.append(session.id, userId, 'user/message', { content: `Task: ${task}\n\nExecute it now, step by step.` });

    const stats = { steps: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0 };
    
    
    const publishEvent = (event) => {
      try {
        publish(topics.runEvents(run.id), { seq: event.seq, runId: run.id, ts: event.ts, type: event.type, data: event.data });
      } catch {  }
    };
    try {
      const result = await orchestrator.runTurn({
        userId,
        sessionId: session.id,
        runId: run.id,
        kind: 'agent',
        conversationId: null,
        projectId: run.projectId,
        query: task,
        modelRowId,
        planMode: true, 
        permissionMode: storedPermissionMode(repos, userId),
        scopeKey: null,
        signal: pollSignal(checkCancel),
        agentIdentity: { name: agent?.name || run.agentName || 'Zeno Agent', systemPrompt: agent?.systemPrompt || null },
        onKernelEvent: publishEvent,
        onPlan: ({ steps, status }) => {
          if (status === 'pending' || status === 'approved') {
            repos.runs.updateRun(run.id, { plan: { steps } });
          }
        },
        onUsage: (u) => {
          stats.tokensIn = u.promptTokens;
          stats.tokensOut = u.completionTokens;
        },
      });

      repos.runs.updateRun(run.id, {
        status: 'completed',
        result: result.text || 'Run ended without a final answer.',
        finishedAt: Date.now(),
        stats,
      });

      
      try {
        await reviewer?.reviewSession({ userId, sessionId: session.id, runId: run.id, conversationId: null, modelRowId, onPlan: null, persistStep: null, publishEvent });
      } catch (err) {
        log.warn(`reviewer failed (non-fatal): ${err.message}`);
      }

      
      if (agent?.id) {
        await memory
          .add({
            userId,
            kind: 'agent',
            agentId: agent.id,
            content: `Run "${task.slice(0, 120)}" completed. Outcome: ${String(result.text || '').slice(0, 300)}`,
            source: 'agent-run',
          })
          .catch(() => {});
      }
    } catch (err) {
      if (err.name === 'AbortError' || cancelled) {
        repos.runs.updateRun(run.id, { status: 'cancelled', finishedAt: Date.now(), error: 'Cancelled by user' });
      } else {
        log.warn(`Run ${run.id} failed: ${err.message}`);
        repos.runs.updateRun(run.id, { status: 'failed', error: err.message, finishedAt: Date.now() });
      }
    } finally {
      
      try {
        const { projectSessionMemory } = await import('../services/memory/projections.js');
        await projectSessionMemory({ memory, repos, userId, sessionId: session.id });
      } catch {  }
      kernel.end(session.id, userId, cancelled ? 'stopped' : 'complete');
      await disposeSession(session.id, 'run-finished');
    }
  }

  
  function pollSignal(checkCancel) {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (checkCancel()) {
        controller.abort();
        clearInterval(timer);
      }
    }, 2000);
    return controller.signal;
  }

  return { startRun, executeRun };
}