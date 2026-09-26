import { j, pj, now } from '../helpers.js';

function rowToRun(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    projectId: r.project_id,
    task: r.task,
    kind: r.kind || 'agent',
    conversationId: r.conversation_id,
    status: r.status,
    plan: pj(r.plan, null),
    result: r.result,
    error: r.error,
    stats: pj(r.stats, {}),
    cancelRequested: !!r.cancel_requested,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    updatedAt: r.updated_at,
  };
}

function rowToEvent(r) {
  return {
    seq: Number(r.seq),
    runId: r.run_id,
    ts: r.ts,
    type: r.type,
    data: pj(r.data, {}),
  };
}

function rowToApproval(r) {
  return {
    id: r.id,
    runId: r.run_id,
    tool: r.tool,
    summary: r.summary,
    payload: pj(r.payload, {}),
    status: r.status,
    scope: r.scope,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

export function createRunsRepo(db) {
  return {
    createRun({ id, userId, agentId, agentName, projectId, task, kind = 'agent', conversationId = null }) {
      const t = now();
      db.run(
        `INSERT INTO agent_runs (id, user_id, agent_id, agent_name, project_id, task, kind, conversation_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [id, userId, agentId || null, agentName || null, projectId || null, task, kind, conversationId, t, t]
      );
    },
    getRun(userId, id) {
      return rowToRun(db.get('SELECT * FROM agent_runs WHERE user_id = ? AND id = ?', [userId, id]));
    },
    getRunRaw(id) {
      return rowToRun(db.get('SELECT * FROM agent_runs WHERE id = ?', [id]));
    },
    listRuns(userId, { status, limit = 50, projectId = null } = {}) {
      const conds = ['user_id = ?'];
      const params = [userId];
      if (status) { conds.push('status = ?'); params.push(status); }
      if (projectId) { conds.push('project_id = ?'); params.push(projectId); }
      return db
        .all(`SELECT * FROM agent_runs WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
        .map(rowToRun);
    },
    
    listRunsWithLegacyEvents() {
      return db
        .all(
          `SELECT DISTINCT r.id, r.user_id, r.kind, r.conversation_id FROM agent_runs r
           JOIN run_events e ON e.run_id = r.id ORDER BY r.created_at ASC`
        )
        .map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind || 'agent', conversationId: r.conversation_id }));
    },
    listActiveRuns(userId) {
      return db
        .all(
          "SELECT * FROM agent_runs WHERE user_id = ? AND status IN ('queued','planning','running','waiting_approval') ORDER BY created_at DESC",
          [userId]
        )
        .map(rowToRun);
    },
    updateRun(id, fields) {
      const map = {
        status: 'status', plan: 'plan', result: 'result', error: 'error', stats: 'stats',
        startedAt: 'started_at', finishedAt: 'finished_at', cancelRequested: 'cancel_requested',
      };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'plan' || col === 'stats') v = j(v);
        if (col === 'cancel_requested') v = v ? 1 : 0;
        sets.push(`${col} = ?`);
        params.push(v);
      }
      params.push(id);
      db.run(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`, params);
    },
    requestCancel(userId, id) {
      db.run('UPDATE agent_runs SET cancel_requested = 1, updated_at = ? WHERE user_id = ? AND id = ?', [now(), userId, id]);
    },

    
    appendEvent({ runId, userId, type, data }) {
      const res = db.run(
        'INSERT INTO run_events (run_id, user_id, ts, type, data) VALUES (?, ?, ?, ?, ?) RETURNING seq',
        [runId, userId, now(), type, j(data || {})]
      );
      return Number(res.lastInsertRowid);
    },
    listEvents(runId, { afterSeq = 0, limit = 2000 } = {}) {
      return db
        .all('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [runId, afterSeq, limit])
        .map(rowToEvent);
    },
    listRecentEvents(userId, limit = 100) {
      return db
        .all('SELECT * FROM run_events WHERE user_id = ? ORDER BY seq DESC LIMIT ?', [userId, limit])
        .map(rowToEvent)
        .reverse();
    },

    
    createApproval({ id, runId, userId, tool, summary, payload }) {
      db.run(
        "INSERT INTO approvals (id, run_id, user_id, tool, summary, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        [id, runId, userId, tool, summary, j(payload || {}), now()]
      );
    },
    getApproval(userId, id) {
      const r = db.get('SELECT * FROM approvals WHERE user_id = ? AND id = ?', [userId, id]);
      return r ? rowToApproval(r) : null;
    },
    decideApproval(userId, id, decision, scope) {
      db.run('UPDATE approvals SET status = ?, scope = ?, decided_at = ? WHERE user_id = ? AND id = ? AND status = ?', [
        decision,
        scope || null,
        now(),
        userId,
        id,
        'pending',
      ]);
      return db.get('SELECT * FROM approvals WHERE id = ?', [id]);
    },
    listApprovals(runId) {
      return db.all('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC', [runId]).map(rowToApproval);
    },
    listPendingApprovals(userId) {
      return db
        .all("SELECT * FROM approvals WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC", [userId])
        .map(rowToApproval);
    },
    grantStanding(userId, runId, tool, { scopeKey = null } = {}) {
      const upsert =
        db.kind === 'postgres'
          ? 'INSERT INTO standing_approvals (user_id, run_id, tool, scope_key, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (run_id, tool) DO NOTHING'
          : 'INSERT OR IGNORE INTO standing_approvals (user_id, run_id, tool, scope_key, created_at) VALUES (?, ?, ?, ?, ?)';
      db.run(upsert, [userId, runId, tool, scopeKey, now()]);
    },
    hasStanding(runId, tool) {
      return !!db.get('SELECT 1 AS x FROM standing_approvals WHERE run_id = ? AND tool = ?', [runId, tool]);
    },
    
    hasStandingScope(userId, scopeKey, tool) {
      if (!scopeKey) return false;
      return !!db.get('SELECT 1 AS x FROM standing_approvals WHERE user_id = ? AND scope_key = ? AND tool = ?', [userId, scopeKey, tool]);
    },
  };
}
