









import { logger } from '../core/logger.js';
import { getDisposals } from '../kernel/lifecycle-registry.js';

const log = logger('control');



const active = new Map(); 

export function trackAbort(sessionId, controller) {
  if (!active.has(sessionId)) active.set(sessionId, new Set());
  active.get(sessionId).add(controller);
  return () => active.get(sessionId)?.delete(controller);
}

function abortAll(sessionId) {
  const set = active.get(sessionId);
  const count = set?.size || 0;
  for (const c of [...(set || [])]) {
    try {
      c.abort();
    } catch {  }
  }
  active.delete(sessionId);
  return count;
}

export function createRuntimeControl({ repos, kernel }) {
  return {
        async abort({ userId, sessionId }) {
      const session = repos.sessions.get(sessionId);
      if (!session || session.userId !== userId) return { ok: false, error: 'Session not found' };
      const interrupted = abortAll(sessionId);
      kernel.append(sessionId, userId, 'turn/aborted', { via: 'control' });
      log.info(`abort session ${sessionId} (${interrupted} in-flight)`);
      return { ok: true, interrupted, sessionStatus: repos.sessions.get(sessionId)?.status };
    },

        async stop({ userId, sessionId }) {
      const session = repos.sessions.get(sessionId);
      if (!session || session.userId !== userId) return { ok: false, error: 'Session not found' };
      abortAll(sessionId);
      const registry = getDisposals(sessionId);
      const errors = registry ? await registry.disposeAll({ reason: 'session-stopped' }) : [];
      kernel.end(sessionId, userId, 'stopped', { disposed: errors.length === 0 });
      log.info(`stop session ${sessionId} (disposal errors: ${errors.length})`);
      return { ok: true, disposalErrors: errors };
    },

        status(sessionId) {
      return repos.sessions.get(sessionId)?.status || null;
    },
  };
}
