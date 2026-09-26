










import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';

const log = logger('kernel');

export class DuplicateSessionError extends Error {
  constructor(existing) {
    super(`An active session already exists (${existing.id})`);
    this.code = 'duplicate_session';
    this.existing = existing;
  }
}

export function createSessionKernel({ repos }) {
  
  function create({ userId, kind, conversationId = null, runId = null, parentSessionId = null, reuse = true }) {
    if (conversationId && reuse) {
      const existing = repos.sessions.activeForConversation(conversationId);
      if (existing) return existing;
    }
    const id = randomId('sess');
    const session = repos.sessions.create({ id, userId, kind, conversationId, runId, parentSessionId });
    append(session.id, userId, 'session/start', { kind, conversationId, runId, parentSessionId });
    return session;
  }

  
  function createStrict(opts) {
    if (opts.conversationId) {
      const existing = repos.sessions.activeForConversation(opts.conversationId);
      if (existing) throw new DuplicateSessionError(existing);
    }
    return create({ ...opts, reuse: false });
  }

  
  function append(sessionId, userId, type, data = {}, { persist = true } = {}) {
    const event = { sessionId, userId, type, data, ts: Date.now(), seq: null };
    if (persist) {
      event.seq = repos.sessions.appendEvent({ sessionId, userId, type, data });
    }
    return event;
  }

  function replay(sessionId, { afterSeq = 0 } = {}) {
    return repos.sessions.listEvents(sessionId, { afterSeq });
  }

  function end(sessionId, userId, status = 'complete', extra = {}) {
    const type = status === 'stopped' ? 'session/stopped' : status === 'failed' ? 'session/failed' : 'session/end';
    append(sessionId, userId, type, { status, ...extra });
    repos.sessions.setStatus(sessionId, status === 'stopped' ? 'stopped' : status === 'failed' ? 'failed' : 'ended');
  }

  return { create, createStrict, append, replay, end };
}
