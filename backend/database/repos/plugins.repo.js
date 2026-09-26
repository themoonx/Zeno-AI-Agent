


import { j, pj, now } from '../helpers.js';

function rowToPlugin(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    slug: r.slug,
    name: r.name,
    version: r.version,
    description: r.description,
    manifest: pj(r.manifest, null),
    hasSecret: !!r.has_secret,
    enabled: !!r.enabled,
    source: r.source,
    status: r.status,
    statusDetail: r.status_detail,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createPluginsRepo(db) {
  return {
    createPlugin({ id, userId, slug, name, version, description, manifest, enabled, source }) {
      const t = now();
      db.run(
        `INSERT INTO plugins (id, user_id, slug, name, version, description, manifest, enabled, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          slug,
          name,
          version || null,
          description || null,
          j(manifest || null),
          enabled === false ? 0 : 1,
          source || 'user',
          t,
          t,
        ]
      );
    },
    listPlugins(userId) {
      return db.all('SELECT * FROM plugins WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToPlugin);
    },
    listEnabled(userId) {
      return db.all('SELECT * FROM plugins WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC', [userId]).map(rowToPlugin);
    },
    getPlugin(userId, id) {
      return rowToPlugin(db.get('SELECT * FROM plugins WHERE user_id = ? AND id = ?', [userId, id]));
    },
    getBySlug(userId, slug) {
      return rowToPlugin(db.get('SELECT * FROM plugins WHERE user_id = ? AND slug = ?', [userId, slug]));
    },
    getPluginRaw(id) {
      return db.get('SELECT * FROM plugins WHERE id = ?', [id]);
    },
    updatePlugin(userId, id, fields) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(fields)) {
        sets.push(`${col} = ?`);
        params.push(col === 'manifest' ? j(val) : val);
      }
      if (!sets.length) return;
      db.run(`UPDATE plugins SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ? AND id = ?`, [...params, now(), userId, id]);
    },
    deletePlugin(userId, id) {
      db.run('DELETE FROM plugins WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countPlugins(userId) {
      return db.get('SELECT COUNT(*) AS c FROM plugins WHERE user_id = ?', [userId]).c;
    },
  };
}