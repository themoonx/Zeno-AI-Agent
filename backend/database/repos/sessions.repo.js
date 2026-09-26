import { j, pj, now } from '../helpers.js';

function rowToSession(r) {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    conversationId: r.conversation_id,
    runId: r.run_id,
    parentSessionId: r.parent_session_id,
    status: r.status || 'active',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToEvent(r) {
  return {
    seq: Number(r.seq),
    sessionId: r.session_id,
    ts: r.ts,
    type: r.type,
    data: pj(r.data, {}),
  };
}

export function createSessionsRepo(db) {
  return {
    create({ id, userId, kind, conversationId = null, runId = null, parentSessionId = null }) {
      const t = now();
      db.run(
        'INSERT INTO agent_sessions (id, user_id, kind, conversation_id, run_id, parent_session_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, userId, kind, conversationId, runId, parentSessionId, 'active', t, t]
      );
      return this.get(id);
    },
    get(id) {
      const r = db.get('SELECT * FROM agent_sessions WHERE id = ?', [id]);
      return r ? rowToSession(r) : null;
    },
    
    activeForConversation(conversationId) {
      const r = db.get("SELECT * FROM agent_sessions WHERE conversation_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [conversationId]);
      return r ? rowToSession(r) : null;
    },
    latestForConversation(conversationId) {
      const r = db.get('SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1', [conversationId]);
      return r ? rowToSession(r) : null;
    },
    activeForRun(runId) {
      const r = db.get("SELECT * FROM agent_sessions WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", [runId]);
      return r ? rowToSession(r) : null;
    },
    setStatus(id, status) {
      db.run('UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]);
    },
    touch(id) {
      db.run('UPDATE agent_sessions SET updated_at = ? WHERE id = ?', [now(), id]);
    },
    list(userId, { kind = null, status = null, limit = 100 } = {}) {
      const conds = ['user_id = ?'];
      const params = [userId];
      if (kind) { conds.push('kind = ?'); params.push(kind); }
      if (status) { conds.push('status = ?'); params.push(status); }
      return db
        .all(`SELECT * FROM agent_sessions WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
        .map(rowToSession);
    },

    
    appendEvent({ sessionId, userId, type, data }) {
      const res = db.run(
        'INSERT INTO agent_events (session_id, user_id, ts, type, data) VALUES (?, ?, ?, ?, ?) RETURNING seq',
        [sessionId, userId, now(), type, j(data || {})]
      );
      this.touch(sessionId);
      return Number(res.lastInsertRowid);
    },
    listEvents(sessionId, { afterSeq = 0, limit = 5000 } = {}) {
      return db
        .all('SELECT * FROM agent_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [sessionId, afterSeq, limit])
        .map(rowToEvent);
    },
    listEventsByUser(userId, { afterSeq = 0, limit = 500 } = {}) {
      return db
        .all('SELECT * FROM agent_events WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [userId, afterSeq, limit])
        .map(rowToEvent);
    },
    lastSeq(sessionId) {
      const r = db.get('SELECT COALESCE(MAX(seq), 0) AS s FROM agent_events WHERE session_id = ?', [sessionId]);
      return Number(r.s);
    },
    
    truncateFrom(sessionId, seq) {
      db.run('DELETE FROM agent_events WHERE session_id = ? AND seq >= ?', [sessionId, seq]);
    },
  };
}
