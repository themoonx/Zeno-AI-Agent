import { j, pj, now } from '../helpers.js';

function rowToConversation(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    systemPrompt: r.system_prompt,
    providerId: r.provider_id,
    modelId: r.model_id,
    modelLabel: r.model_label,
    params: pj(r.params, {}),
    summary: r.summary,
    summaryUptoSeq: r.summary_upto_seq != null ? Number(r.summary_upto_seq) : null,
    pinned: !!r.pinned,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastMessageAt: r.last_message_at,
  };
}

function rowToMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    seq: r.seq,
    role: r.role,
    content: r.content,
    attachments: pj(r.attachments, []),
    reasoning: r.reasoning,
    usage: pj(r.usage),
    modelLabel: r.model_label,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  };
}

export function createChatRepo(db) {
  return {
    
    createConversation({ id, userId, projectId, title, systemPrompt, providerId, modelId, modelLabel, params }) {
      const t = now();
      db.run(
        `INSERT INTO conversations (id, user_id, project_id, title, system_prompt, provider_id, model_id, model_label, params, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, projectId || null, title || 'New conversation', systemPrompt || null, providerId || null, modelId || null, modelLabel || null, j(params || {}), t, t]
      );
    },
    listConversations(userId, { includeArchived = false, projectId = null } = {}) {
      const conds = ['user_id = ?'];
      const params = [userId];
      if (!includeArchived) conds.push('archived = 0');
      if (projectId) { conds.push('project_id = ?'); params.push(projectId); }
      return db
        .all(`SELECT * FROM conversations WHERE ${conds.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT 500`, params)
        .map(rowToConversation);
    },
    getConversation(userId, id) {
      return rowToConversation(db.get('SELECT * FROM conversations WHERE user_id = ? AND id = ?', [userId, id]));
    },
    updateConversation(userId, id, fields) {
      const map = {
        title: 'title', systemPrompt: 'system_prompt', providerId: 'provider_id', modelId: 'model_id',
        modelLabel: 'model_label', params: 'params', pinned: 'pinned', archived: 'archived', projectId: 'project_id',
        summary: 'summary', summaryUptoSeq: 'summary_upto_seq',
      };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'params') v = j(v);
        if (col === 'pinned' || col === 'archived') v = v ? 1 : 0;
        if (col === 'summary_upto_seq') v = v == null ? null : Number(v);
        sets.push(`${col} = ?`);
        params.push(v);
      }
      if (sets.length <= 1) return;
      params.push(userId, id);
      db.run(`UPDATE conversations SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    touchConversation(id) {
      db.run('UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ?', [now(), now(), id]);
    },
    deleteConversation(userId, id) {
      db.run('DELETE FROM conversations WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countConversations(userId) {
      return db.get('SELECT COUNT(*) AS c FROM conversations WHERE user_id = ?', [userId]).c;
    },
    
    listAllConversationHeaders() {
      return db.all('SELECT id, user_id FROM conversations ORDER BY created_at ASC');
    },

    
    nextSeq(conversationId) {
      const row = db.get('SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE conversation_id = ?', [conversationId]);
      return Number(row.m) + 1;
    },
    insertMessage({ id, conversationId, userId, seq, role, content, attachments, reasoning, usage, modelLabel, status }) {
      db.run(
        `INSERT INTO messages (id, conversation_id, user_id, seq, role, content, attachments, reasoning, usage, model_label, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, conversationId, userId, seq, role, content || '', j(attachments || null), reasoning || null, j(usage || null), modelLabel || null, status || 'complete', now()]
      );
    },
    listMessages(conversationId, { limit = 1000, beforeSeq = null } = {}) {
      let sql = 'SELECT * FROM messages WHERE conversation_id = ?';
      const params = [conversationId];
      if (beforeSeq) { sql += ' AND seq < ?'; params.push(beforeSeq); }
      sql += ' ORDER BY seq ASC LIMIT ?';
      params.push(limit);
      return db.all(sql, params).map(rowToMessage);
    },
    getMessage(id) {
      return rowToMessage(db.get('SELECT * FROM messages WHERE id = ?', [id]));
    },
    updateMessage(id, fields) {
      const map = { content: 'content', reasoning: 'reasoning', usage: 'usage', status: 'status', error: 'error', modelLabel: 'model_label', attachments: 'attachments' };
      const sets = [];
      const params = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'usage' || col === 'attachments') v = j(v);
        sets.push(`${col} = ?`);
        params.push(v);
      }
      if (!sets.length) return;
      params.push(id);
      db.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, params);
    },
    deleteMessage(userId, id) {
      db.run('DELETE FROM messages WHERE user_id = ? AND id = ?', [userId, id]);
    },
    
    deleteMessagesFrom(conversationId, seq) {
      db.run('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?', [conversationId, seq]);
    },
    lastUserMessage(conversationId) {
      return rowToMessage(
        db.get("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY seq DESC LIMIT 1", [conversationId])
      );
    },
  };
}
