

import { j, pj, now } from '../helpers.js';

function rowToSkill(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    triggers: pj(r.triggers, []),
    tools: pj(r.tools, []),
    enabled: !!r.enabled,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createSkillsRepo(db) {
  return {
    createSkill({ id, userId, slug, name, description, instructions, triggers, tools, enabled, source }) {
      const t = now();
      db.run(
        `INSERT INTO skills (id, user_id, slug, name, description, instructions, triggers, tools, enabled, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          slug,
          name,
          description || null,
          instructions,
          j(triggers || []),
          j(tools || []),
          enabled === false ? 0 : 1,
          source || 'user',
          t,
          t,
        ]
      );
    },
    listSkills(userId) {
      return db.all('SELECT * FROM skills WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToSkill);
    },
    listEnabled(userId) {
      return db.all('SELECT * FROM skills WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC', [userId]).map(rowToSkill);
    },
    getSkill(userId, id) {
      return rowToSkill(db.get('SELECT * FROM skills WHERE user_id = ? AND id = ?', [userId, id]));
    },
    getBySlug(userId, slug) {
      return rowToSkill(db.get('SELECT * FROM skills WHERE user_id = ? AND slug = ?', [userId, slug]));
    },
    updateSkill(userId, id, fields) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(fields)) {
        sets.push(`${col} = ?`);
        params.push(col === 'triggers' || col === 'tools' ? j(val) : val);
      }
      if (!sets.length) return;
      db.run(`UPDATE skills SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ? AND id = ?`, [...params, now(), userId, id]);
    },
    deleteSkill(userId, id) {
      db.run('DELETE FROM skills WHERE user_id = ? AND id = ?', [userId, id]);
    },
    countSkills(userId) {
      return db.get('SELECT COUNT(*) AS c FROM skills WHERE user_id = ?', [userId]).c;
    },
  };
}