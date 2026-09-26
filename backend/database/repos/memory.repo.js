import { j, pj, now } from '../helpers.js';

function rowToMemory(r) {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    projectId: r.project_id,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    embeddingModel: r.embedding_model,
    hasEmbedding: !!r.embedding,
    source: r.source,
    importance: r.importance != null ? Number(r.importance) : 0.5,
    confidence: r.confidence != null ? Number(r.confidence) : 0.8,
    accessCount: r.access_count != null ? Number(r.access_count) : 0,
    lastAccessedAt: r.last_accessed_at,
    expiresAt: r.expires_at,
    supersededBy: r.superseded_by,
    status: r.status || 'active',
    tags: pj(r.tags, []),
    subject: r.subject,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createMemoryRepo(db) {
  return {
    insert({ id, userId, projectId, agentId, conversationId, kind, content, embedding, embeddingModel, source, importance, confidence, tags, subject, expiresAt, status }) {
      const t = now();
      db.run(
        `INSERT INTO memories (id, user_id, project_id, agent_id, conversation_id, kind, content, embedding, embedding_model, source, importance, confidence, access_count, last_accessed_at, expires_at, superseded_by, status, tags, subject, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          projectId || null,
          agentId || null,
          conversationId || null,
          kind,
          content,
          j(embedding || null),
          embeddingModel || null,
          source || null,
          importance != null ? Math.max(0, Math.min(1, Number(importance))) : 0.5,
          confidence != null ? Math.max(0, Math.min(1, Number(confidence))) : 0.8,
          expiresAt || null,
          status || 'active',
          j(tags && tags.length ? tags : null),
          subject || null,
          t,
          t,
        ]
      );
    },
    get(userId, id) {
      const r = db.get('SELECT * FROM memories WHERE user_id = ? AND id = ?', [userId, id]);
      return r ? rowToMemory(r) : null;
    },
    
    getRawById(id) {
      const r = db.get('SELECT * FROM memories WHERE id = ?', [id]);
      return r ? { ...rowToMemory(r), embedding: pj(r.embedding, null) } : null;
    },
    
    listForSearch(userId, { projectId = null, agentId = null } = {}) {
      const conds = ["user_id = ?", "(status = 'active' OR status IS NULL)", 'superseded_by IS NULL'];
      const params = [userId];
      if (projectId) { conds.push('(project_id = ? OR project_id IS NULL)'); params.push(projectId); }
      if (agentId) { conds.push('(agent_id = ? OR agent_id IS NULL)'); params.push(agentId); }
      return db
        .all(`SELECT * FROM memories WHERE ${conds.join(' AND ')}`, params)
        .map((r) => ({ ...rowToMemory(r), embedding: pj(r.embedding, null) }));
    },
    list(userId, { kind, projectId, agentId, limit = 200, includeInactive = false } = {}) {
      const conds = ['user_id = ?'];
      const params = [userId];
      if (!includeInactive) conds.push("(status = 'active' OR status IS NULL)");
      if (kind) { conds.push('kind = ?'); params.push(kind); }
      if (projectId) { conds.push('project_id = ?'); params.push(projectId); }
      if (agentId) { conds.push('agent_id = ?'); params.push(agentId); }
      return db
        .all(`SELECT * FROM memories WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`, [...params, limit])
        .map(rowToMemory);
    },
    updateContent(userId, id, content) {
      db.run('UPDATE memories SET content = ?, updated_at = ? WHERE user_id = ? AND id = ?', [content, now(), userId, id]);
    },
    
    updateFields(userId, id, fields) {
      const map = { content: 'content', importance: 'importance', confidence: 'confidence', expiresAt: 'expires_at', status: 'status', tags: 'tags', subject: 'subject', supersededBy: 'superseded_by', embedding: 'embedding', embeddingModel: 'embedding_model' };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'tags' || col === 'embedding') v = j(v);
        sets.push(`${col} = ?`);
        params.push(v);
      }
      if (sets.length <= 1) return;
      params.push(userId, id);
      db.run(`UPDATE memories SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    
    
    reinforce(id) {
      db.run('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);
    },
    delete(userId, id) {
      db.run('DELETE FROM memories WHERE user_id = ? AND id = ?', [userId, id]);
    },
    count(userId) {
      return db.get('SELECT COUNT(*) AS c FROM memories WHERE user_id = ?', [userId]).c;
    },
    stats(userId) {
      const byKind = db.all("SELECT kind, COUNT(*) AS c FROM memories WHERE user_id = ? AND (status = 'active' OR status IS NULL) GROUP BY kind", [userId]);
      const row = db.get("SELECT COUNT(*) AS total, COALESCE(AVG(importance), 0) AS avg_importance FROM memories WHERE user_id = ? AND (status = 'active' OR status IS NULL)", [userId]);
      return {
        total: Number(row?.total || 0),
        avgImportance: Number(row?.avg_importance || 0),
        byKind: Object.fromEntries(byKind.map((r) => [r.kind, Number(r.c)])),
      };
    },
  };
}
