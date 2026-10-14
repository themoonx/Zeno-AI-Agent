// Runtime control — two distinct execution transitions the audit requires:
//
//   Abort  — interrupt the current in-flight operation. The turn ends
//            (`turn/aborted`), the session and its history survive, and the
//            user can continue the conversation.
//   Stop   — terminate the session: abort + dispose every resource the
//            session's lifecycle registry holds (streams, child processes,
//            subagent sessions), mark `session/stopped`, close the session.
//
// Both are runtime transitions, not UI flags — the backend owns them.
import { logger } from '../core/logger.js';
import { getDisposals } from '../kernel/lifecycle-registry.js';

const log = logger('control');

// In-flight abort controllers per session (chat turns register theirs here so
// the Stop transition can abort whatever is running, even across requests).
const active = new Map(); // sessionId -> Set<AbortController>

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
    } catch { /* already aborted */ }
  }
  active.delete(sessionId);
  return count;
}

export function createRuntimeControl({ repos, kernel }) {
  return {
    /** Abort: interrupt in-flight work; the session remains active. */
    async abort({ userId, sessionId }) {
      const session = repos.sessions.get(sessionId);
      if (!session || session.userId !== userId) return { ok: false, error: 'Session not found' };
      const interrupted = abortAll(sessionId);
      kernel.append(sessionId, userId, 'turn/aborted', { via: 'control' });
      log.info(`abort session ${sessionId} (${interrupted} in-flight)`);
      return { ok: true, interrupted, sessionStatus: repos.sessions.get(sessionId)?.status };
    },

    /** Stop: abort + dispose session resources + close the session. */
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

    /** Status of a session (active | ended | stopped | failed). */
    status(sessionId) {
      return repos.sessions.get(sessionId)?.status || null;
    },
  };
}
