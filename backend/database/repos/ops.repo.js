import { j, pj, now } from '../helpers.js';

function rowToFile(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    sha256: r.sha256,
    kind: r.kind,
    hasExtractedText: !!r.extracted_text,
    createdAt: r.created_at,
  };
}

export function createFilesRepo(db) {
  return {
    insert({ id, userId, projectId, conversationId, filename, mime, size, storagePath, sha256, kind, extractedText }) {
      db.run(
        `INSERT INTO files (id, user_id, project_id, conversation_id, filename, mime, size, storage_path, sha256, kind, extracted_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, projectId || null, conversationId || null, filename, mime, size, storagePath, sha256 || null, kind, extractedText || null, now()]
      );
    },
    get(userId, id) {
      return rowToFile(db.get('SELECT * FROM files WHERE user_id = ? AND id = ?', [userId, id]));
    },
    getRaw(id) {
      return db.get('SELECT * FROM files WHERE id = ?', [id]);
    },
    list(userId, { projectId = null, conversationId = null, limit = 500 } = {}) {
      const conds = ['user_id = ?'];
      const params = [userId];
      if (projectId) { conds.push('project_id = ?'); params.push(projectId); }
      if (conversationId) { conds.push('conversation_id = ?'); params.push(conversationId); }
      return db
        .all(`SELECT * FROM files WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
        .map(rowToFile);
    },
    delete(userId, id) {
      db.run('DELETE FROM files WHERE user_id = ? AND id = ?', [userId, id]);
    },
    setExtractedText(id, text) {
      db.run('UPDATE files SET extracted_text = ? WHERE id = ?', [text, id]);
    },
  };
}

export function createOpsRepo(db) {
  return {
    audit({ userId, action, target, meta, ip }) {
      db.run('INSERT INTO audit_logs (user_id, action, target, meta, ip, ts) VALUES (?, ?, ?, ?, ?, ?)', [
        userId || null,
        action,
        target || null,
        j(meta || null),
        ip || null,
        now(),
      ]);
    },
    listAudit(userId, { limit = 100 } = {}) {
      return db
        .all('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY seq DESC LIMIT ?', [userId, limit])
        .map((r) => ({ seq: Number(r.seq), action: r.action, target: r.target, meta: pj(r.meta), ts: r.ts }));
    },

    
    recordTelemetry({ id, userId, sessionId, runId, turnId, callId, kind, fields }) {
      db.run(
        'INSERT INTO telemetry (id, user_id, session_id, run_id, turn_id, call_id, kind, fields, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, userId, sessionId || null, runId || null, turnId || null, callId || null, kind, j(fields || {}), now()]
      );
    },
    telemetrySummary(userId, { sinceMs = 24 * 3600 * 1000 } = {}) {
      const since = now() - sinceMs;
      const byKind = db.all('SELECT kind, COUNT(*) AS count FROM telemetry WHERE user_id = ? AND ts >= ? GROUP BY kind', [userId, since]);
      const rows = db.all("SELECT fields FROM telemetry WHERE user_id = ? AND ts >= ? AND kind = 'model.call'", [userId, since]).map((r) => pj(r.fields, {}));
      const toolRows = db.all("SELECT fields FROM telemetry WHERE user_id = ? AND ts >= ? AND kind = 'tool.exec'", [userId, since]).map((r) => pj(r.fields, {}));
      const latencies = rows.map((r) => Number(r.latencyMs) || 0).filter((n) => n > 0);
      return {
        windowMs: sinceMs,
        byKind: Object.fromEntries(byKind.map((r) => [r.kind, Number(r.count)])),
        modelCalls: rows.length,
        avgModelLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        promptTokens: rows.reduce((a, r) => a + (Number(r.promptTokens) || 0), 0),
        completionTokens: rows.reduce((a, r) => a + (Number(r.completionTokens) || 0), 0),
        toolCalls: toolRows.length,
        toolFailures: toolRows.filter((r) => r.ok === false).length,
      };
    },

    
    enqueue({ type, payload, userId, runAfter = 0, maxAttempts = 3 }) {
      const t = now();
      const res = db.run(
        'INSERT INTO jobs (type, payload, user_id, run_after, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq',
        [type, j(payload || {}), userId || null, runAfter, maxAttempts, t, t]
      );
      return Number(res.lastInsertRowid);
    },
    
    claimNext(workerId, types) {
      const placeholders = types.map(() => '?').join(',');
      const sql =
        'UPDATE jobs SET status = ?, locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ? ' +
        `WHERE seq = (SELECT seq FROM jobs WHERE status = ? AND run_after <= ? AND type IN (${placeholders}) ` +
        'ORDER BY seq ASC LIMIT 1) RETURNING *';
      const params = ['running', workerId, now(), now(), 'queued', now(), ...types];
      const row = db.get(sql, params);
      if (!row) return null;
      return {
        seq: Number(row.seq),
        type: row.type,
        payload: pj(row.payload, {}),
        userId: row.user_id,
        attempts: Number(row.attempts),
        maxAttempts: Number(row.max_attempts),
      };
    },
    completeJob(seq, result) {
      db.run('UPDATE jobs SET status = ?, result = ?, updated_at = ? WHERE seq = ?', ['done', j(result || null), now(), seq]);
    },
    failJob(seq, error, retryDelayMs = 30_000) {
      const job = db.get('SELECT attempts, max_attempts FROM jobs WHERE seq = ?', [seq]);
      if (!job) return;
      if (Number(job.attempts) >= Number(job.max_attempts)) {
        db.run('UPDATE jobs SET status = ?, last_error = ?, updated_at = ? WHERE seq = ?', ['failed', error, now(), seq]);
      } else {
        db.run('UPDATE jobs SET status = ?, run_after = ?, last_error = ?, updated_at = ? WHERE seq = ?', [
          'queued',
          now() + retryDelayMs,
          error,
          now(),
          seq,
        ]);
      }
    },
    
    requeueStale(staleMs = 10 * 60_000) {
      db.run('UPDATE jobs SET status = ?, updated_at = ? WHERE status = ? AND locked_at < ?', [
        'queued',
        now(),
        'running',
        now() - staleMs,
      ]);
    },
    listJobs(userId, { limit = 100 } = {}) {
      return db
        .all('SELECT * FROM jobs WHERE user_id = ? ORDER BY seq DESC LIMIT ?', [userId, limit])
        .map((r) => ({
          seq: Number(r.seq),
          type: r.type,
          status: r.status,
          payload: pj(r.payload),
          attempts: Number(r.attempts),
          lastError: r.last_error,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));
    },
  };
}
