import { j, pj, now } from '../helpers.js';

function rowToConnector(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    name: r.name,
    endpoint: r.endpoint,
    hasSecret: !!r.has_secret,
    headers: pj(r.headers, {}),
    schemaSpec: pj(r.schema_spec, null),
    enabled: !!r.enabled,
    toolName: r.tool_name,
    toolDescription: r.tool_description,
    status: r.status,
    statusDetail: r.status_detail,
    statusCheckedAt: r.status_checked_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createConnectorsRepo(db) {
  return {
    createConnector({ id, userId, kind, name, endpoint, secretEnc, headers, schemaSpec, toolName, toolDescription, enabled }) {
      const t = now();
      db.run(
        `INSERT INTO connectors (id, user_id, kind, name, endpoint, secret_enc, has_secret, headers, schema_spec, tool_name, tool_description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, kind, name, endpoint, secretEnc || null, secretEnc ? 1 : 0, j(headers || {}), schemaSpec === undefined ? null : j(schemaSpec), toolName || null, toolDescription || null, enabled ? 1 : 0, t, t]
      );
    },
    listConnectors(userId) {
      return db.all('SELECT * FROM connectors WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToConnector);
    },
    listEnabled(userId) {
      return db.all('SELECT * FROM connectors WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC', [userId]).map(rowToConnector);
    },
    getConnector(userId, id) {
      return rowToConnector(db.get('SELECT * FROM connectors WHERE user_id = ? AND id = ?', [userId, id]));
    },
    getConnectorRaw(id) {
      return db.get('SELECT * FROM connectors WHERE id = ?', [id]);
    },
    updateConnector(userId, id, fields) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(fields)) {
        sets.push(`${col} = ?`);
        params.push(col === 'headers' || col === 'schema_spec' ? j(val) : val);
      }
      if (!sets.length) return;
      db.run(`UPDATE connectors SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ? AND id = ?`, [...params, now(), userId, id]);
    },
    deleteConnector(userId, id) {
      db.run('DELETE FROM connectors WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countConnectors(userId) {
      return db.get('SELECT COUNT(*) AS c FROM connectors WHERE user_id = ?', [userId]).c;
    },
  };
}
