// Session Kernel — the append-only event log that is the SOURCE OF TRUTH for
// agent execution. Everything durable a turn does lands here first; the
// messages table, plan cards, tool activity, and usage views are all
// projections derived from this log. The model-visible transcript is
// reconstructed from events (see ./invariant.js) — never hand-assembled.
//
// Durable vs live: every append writes to the log (persisted) AND is handed to
// the onFrame callback for live relay. Transient streaming events
// (`output/delta`, `output/reasoning`, `phase/changed`) append with
// { persist: false } — they exist only on the live channel and are never
// replayed, keeping the durable log small and the invariant check fast.
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
  /**
   * Create a session. Duplicate identity is rejected: one ACTIVE session per
   * conversation. `reuse` (default) returns the existing active session
   * instead of throwing — callers that need strictness pass reuse: false.
   */
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

  /** Strict create — throws DuplicateSessionError on an active duplicate. */
  function createStrict(opts) {
    if (opts.conversationId) {
      const existing = repos.sessions.activeForConversation(opts.conversationId);
      if (existing) throw new DuplicateSessionError(existing);
    }
    return create({ ...opts, reuse: false });
  }

  /**
   * Append one event. persist:false = live-only (never written, never
   * replayed). Surfaces that need a live relay own it explicitly: the chat
   * stream maps frames via onEvent, background runs publish to their
   * run-events topic via the orchestrator's onKernelEvent hook. There is no
   * global listener registry — every relay has a declared consumer.
   */
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
