// Job processors: agent execution + conversation memory extraction.
import { registerProcessor } from './worker.js';
import { logger } from '../core/logger.js';

const log = logger('jobs');

export function registerJobProcessors({ repos, runtime, memory, jobsRef }) {
  // agent.run — execute an agent run to completion.
  registerProcessor('agent.run', async (payload) => {
    await runtime.executeRun(payload.runId);
    return { ok: true, runId: payload.runId };
  });

  // memory.extract — distill durable facts from a finished conversation, then
  // run a consolidation pass (merge/strengthen/expire) to keep the store clean.
  registerProcessor('memory.extract', async (payload, { userId }) => {
    if (!payload.modelRowId) {
      const model = repos.users.getSetting(userId, 'default_model');
      if (!model?.modelId) return { skipped: 'no model configured' };
      payload.modelRowId = model.modelId;
    }
    const result = await memory.extractFromConversation({
      userId,
      conversationId: payload.conversationId,
      modelRowId: payload.modelRowId,
    });
    let consolidation = null;
    try {
      consolidation = await memory.consolidate(userId);
    } catch (err) {
      // never fail the extraction job because cleanup hiccuped
    }
    return { ...result, consolidation };
  });
}

export function enqueueAgentRun({ repos }, runId, userId) {
  const seq = repos.ops.enqueue({ type: 'agent.run', payload: { runId }, userId, maxAttempts: 1 });
  log.debug(`queued agent.run ${runId} (job #${seq})`);
  return seq;
}

export function enqueueMemoryExtraction({ repos }, conversationId, userId) {
  return repos.ops.enqueue({ type: 'memory.extract', payload: { conversationId }, userId, maxAttempts: 2 });
}
