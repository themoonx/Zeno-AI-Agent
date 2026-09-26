import { j, pj, now } from '../helpers.js';

function rowToProvider(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    baseUrl: r.base_url,
    hasCredentials: !!r.has_credentials,
    extraHeaders: pj(r.extra_headers, {}),
    params: pj(r.params, {}),
    status: r.status,
    statusDetail: r.status_detail,
    statusCheckedAt: r.status_checked_at,
    createdAt: r.created_at,
  };
}

function rowToModel(r) {
  if (!r) return null;
  return {
    id: r.id,
    providerId: r.provider_id,
    modelId: r.model_id,
    displayName: r.display_name,
    contextWindow: r.context_window,
    maxOutputTokens: r.max_output_tokens,
    capabilities: pj(r.capabilities, []),
    params: pj(r.params, {}),
    createdAt: r.created_at,
  };
}

export function createProvidersRepo(db) {
  return {
    createProvider({ id, userId, kind, name, baseUrl, credentialsEnc, extraHeaders, params }) {
      db.run(
        `INSERT INTO providers (id, user_id, kind, name, base_url, credentials, has_credentials, extra_headers, params, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, kind, name, baseUrl, credentialsEnc, credentialsEnc ? 1 : 0, j(extraHeaders || {}), j(params || {}), now()]
      );
    },
    listProviders(userId) {
      return db.all('SELECT * FROM providers WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToProvider);
    },
    getProvider(userId, id) {
      return rowToProvider(db.get('SELECT * FROM providers WHERE user_id = ? AND id = ?', [userId, id]));
    },
    
    getProviderRaw(id) {
      return db.get('SELECT * FROM providers WHERE id = ?', [id]);
    },
    updateProviderStatus(userId, id, status, detail) {
      db.run('UPDATE providers SET status = ?, status_detail = ?, status_checked_at = ? WHERE user_id = ? AND id = ?', [
        status,
        detail || null,
        now(),
        userId,
        id,
      ]);
    },
    updateProvider(userId, id, fields) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(fields)) {
        sets.push(`${col} = ?`);
        params.push(col.endsWith('_headers') || col === 'params' ? j(val) : val);
      }
      if (!sets.length) return;
      params.push(userId, id);
      db.run(`UPDATE providers SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    deleteProvider(userId, id) {
      db.run('DELETE FROM providers WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countProviders(userId) {
      return db.get('SELECT COUNT(*) AS c FROM providers WHERE user_id = ?', [userId]).c;
    },

    
    createModel({ id, userId, providerId, modelId, displayName, contextWindow, maxOutputTokens, capabilities, params }) {
      db.run(
        `INSERT INTO models (id, user_id, provider_id, model_id, display_name, context_window, max_output_tokens, capabilities, params, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, providerId, modelId, displayName, contextWindow || null, maxOutputTokens || null, j(capabilities || []), j(params || {}), now()]
      );
    },
    listModels(userId) {
      return db.all('SELECT * FROM models WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToModel);
    },
    listModelsForProvider(userId, providerId) {
      return db
        .all('SELECT * FROM models WHERE user_id = ? AND provider_id = ? ORDER BY created_at ASC', [userId, providerId])
        .map(rowToModel);
    },
    getModel(userId, id) {
      return rowToModel(db.get('SELECT * FROM models WHERE user_id = ? AND id = ?', [userId, id]));
    },
    
    getModelRaw(id) {
      return rowToModel(db.get('SELECT * FROM models WHERE id = ?', [id]));
    },
    updateModel(userId, id, fields) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(fields)) {
        sets.push(`${col} = ?`);
        params.push(col === 'capabilities' || col === 'params' ? j(val) : val);
      }
      if (!sets.length) return;
      params.push(userId, id);
      db.run(`UPDATE models SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    deleteModel(userId, id) {
      db.run('DELETE FROM models WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countModels(userId) {
      return db.get('SELECT COUNT(*) AS c FROM models WHERE user_id = ?', [userId]).c;
    },
  };
}
