






import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { disposeSession, getDisposals } from '../kernel/lifecycle-registry.js';

const log = logger('subagents');

export function createSubagentRunner({ repos, kernel, orchestrator, telemetry }) {
    async function runSubagent({ userId, parentSessionId, parentRunId, task, tools, modelRowId, permissionMode, signal, maxSteps = 8 }) {
    const session = kernel.create({
      userId,
      kind: 'subagent',
      runId: parentRunId,
      parentSessionId,
      reuse: false,
    });
    kernel.append(session.id, userId, 'subagent/assigned', { subSessionId: session.id, task });
    
    getDisposals(parentSessionId)?.register(`subagent:${session.id}`, () => repos.sessions.setStatus(session.id, 'stopped'));

    try {
      const result = await orchestrator.runTurn({
        userId,
        sessionId: session.id,
        runId: parentRunId,
        kind: 'subagent',
        conversationId: null,
        projectId: null,
        query: task,
        modelRowId,
        planMode: false,
        permissionMode,
        scopeKey: null,
        tools,
        signal,
        maxRoundsOverride: maxSteps,
      });
      const tokens = (result.usage?.promptTokens || 0) + (result.usage?.completionTokens || 0);
      kernel.append(session.id, userId, 'subagent/completed', { subSessionId: session.id, result: String(result.text || '').slice(0, 4000), usage: result.usage });
      telemetry?.subagent({ userId, sessionId: parentSessionId, subSessionId: session.id, tokens, ok: true });
      kernel.end(session.id, userId, 'complete');
      return { ok: true, sessionId: session.id, text: result.text, usage: result.usage };
    } catch (err) {
      kernel.append(session.id, userId, 'subagent/completed', { subSessionId: session.id, result: err.message, failed: true });
      telemetry?.subagent({ userId, sessionId: parentSessionId, subSessionId: session.id, tokens: 0, ok: false });
      kernel.end(session.id, userId, err.name === 'AbortError' ? 'stopped' : 'failed');
      return { ok: false, sessionId: session.id, text: `Subagent failed: ${err.message}` };
    } finally {
      disposeSession(session.id, 'subagent-finished');
    }
  }

  return { runSubagent };
}

export function createDelegateTool({ subagents, repos, kernel }) {
  return {
    name: 'delegate',
    displayName: 'Delegate to Subagent',
    description:
      'Spawn an independent child agent to complete a focused sub-task with its own context (research, analysis, exploration) and return its final report. Use for parallelizable or context-heavy work that would crowd the main conversation.',
    sensitive: false, 
    permissionClass: 'agent.delegate',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'One or more focused sub-tasks. Multiple tasks run in parallel as separate child agents.',
          items: { type: 'string' },
          maxItems: 4,
        },
      },
      required: ['tasks'],
    },
    async execute(args, { userId, runId, sessionId, signal, emit, memory }) {
      const tasks = (Array.isArray(args.tasks) ? args.tasks : [args.tasks]).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 4);
      if (!tasks.length) throw new Error('tasks is required');
      const modelRowId = repos.users.getSetting(userId, 'default_model')?.modelId || repos.providers.listModels(userId)[0]?.id;
      if (!modelRowId) throw new Error('No model configured for subagents');

      
      const childTools = (await import('../tools/registry.js')).toolSchemasFor(['web_search', 'browser_read', 'file_read', 'file_list', 'memory_search', 'skill_load']);

      const results = await Promise.all(
        tasks.map((task) =>
          subagents.runSubagent({
            userId,
            parentSessionId: sessionId,
            parentRunId: runId,
            task,
            tools: childTools,
            modelRowId,
            permissionMode: repos.users.getSetting(userId, 'permission_mode') || 'ask',
            signal,
          }).catch((err) => ({ ok: false, text: `Subagent failed: ${err.message}`, usage: {} }))
        )
      );

      for (const r of results) {
        kernel.append(sessionId, userId, 'subagent/completed', { subSessionId: r.sessionId, result: String(r.text || '').slice(0, 2000), usage: r.usage, failed: !r.ok });
      }
      const usage = results.reduce((acc, r) => ({ promptTokens: acc.promptTokens + (r.usage?.promptTokens || 0), completionTokens: acc.completionTokens + (r.usage?.completionTokens || 0) }), { promptTokens: 0, completionTokens: 0 });
      return {
        ok: results.every((r) => r.ok),
        results: results.map((r, i) => ({ task: tasks[i], sessionId: r.sessionId, report: String(r.text || '').slice(0, 4000), ok: r.ok })),
        usage,
      };
    },
  };
}
