import { j, pj, now } from '../helpers.js';

function rowToProject(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    systemPrompt: r.system_prompt,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToAgent(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    systemPrompt: r.system_prompt,
    model: pj(r.model, null),
    allowedTools: pj(r.allowed_tools, null),
    maxSteps: r.max_steps,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createProjectsRepo(db) {
  return {
    createProject({ id, userId, name, description, systemPrompt, color }) {
      const t = now();
      db.run(
        'INSERT INTO projects (id, user_id, name, description, system_prompt, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, userId, name, description || null, systemPrompt || null, color || null, t, t]
      );
    },
    listProjects(userId) {
      return db.all('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC', [userId]).map(rowToProject);
    },
    getProject(userId, id) {
      return rowToProject(db.get('SELECT * FROM projects WHERE user_id = ? AND id = ?', [userId, id]));
    },
    updateProject(userId, id, fields) {
      const map = { name: 'name', description: 'description', systemPrompt: 'system_prompt', color: 'color' };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        sets.push(`${col} = ?`);
        params.push(fields[k]);
      }
      if (sets.length <= 1) return;
      params.push(userId, id);
      db.run(`UPDATE projects SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    deleteProject(userId, id) {
      db.run('DELETE FROM projects WHERE user_id = ? AND id = ?', [userId, id]);
    },
  };
}

export function createAgentsRepo(db) {
  return {
    createAgent({ id, userId, projectId, name, description, systemPrompt, model, allowedTools, maxSteps }) {
      const t = now();
      db.run(
        `INSERT INTO agents (id, user_id, project_id, name, description, system_prompt, model, allowed_tools, max_steps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, projectId || null, name, description || null, systemPrompt || null, j(model || null), j(allowedTools || null), maxSteps || null, t, t]
      );
    },
    listAgents(userId) {
      return db.all('SELECT * FROM agents WHERE user_id = ? ORDER BY updated_at DESC', [userId]).map(rowToAgent);
    },
    getAgent(userId, id) {
      return rowToAgent(db.get('SELECT * FROM agents WHERE user_id = ? AND id = ?', [userId, id]));
    },
    updateAgent(userId, id, fields) {
      const map = {
        name: 'name', description: 'description', systemPrompt: 'system_prompt',
        model: 'model', allowedTools: 'allowed_tools', maxSteps: 'max_steps', projectId: 'project_id',
      };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'model' || col === 'allowed_tools') v = j(v);
        sets.push(`${col} = ?`);
        params.push(v);
      }
      if (sets.length <= 1) return;
      params.push(userId, id);
      db.run(`UPDATE agents SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    deleteAgent(userId, id) {
      db.run('DELETE FROM agents WHERE user_id = ? AND id = ?', [userId, id]);
    },
  };
}
