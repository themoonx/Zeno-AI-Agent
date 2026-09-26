import { now } from '../helpers.js';

function rowToRule(r) {
  return {
    id: r.id,
    userId: r.user_id,
    subject: r.subject,
    effect: r.effect,
    createdAt: r.created_at,
  };
}

export function createPolicyRepo(db) {
  return {
    insert({ id, userId, subject, effect }) {
      db.run('INSERT INTO policy_rules (id, user_id, subject, effect, created_at) VALUES (?, ?, ?, ?, ?)', [
        id,
        userId,
        subject,
        effect,
        now(),
      ]);
      return this.get(userId, id);
    },
    get(userId, id) {
      const r = db.get('SELECT * FROM policy_rules WHERE user_id = ? AND id = ?', [userId, id]);
      return r ? rowToRule(r) : null;
    },
    list(userId) {
      return db.all('SELECT * FROM policy_rules WHERE user_id = ? ORDER BY created_at ASC', [userId]).map(rowToRule);
    },
    
    listForDecision(userId) {
      return db
        .all('SELECT * FROM policy_rules WHERE user_id = ? ORDER BY LENGTH(subject) DESC, created_at ASC', [userId])
        .map(rowToRule);
    },
    delete(userId, id) {
      db.run('DELETE FROM policy_rules WHERE user_id = ? AND id = ?', [userId, id]);
    },
  };
}

function rowToAgent(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    roots: r.roots ? r.roots.split(';').filter(Boolean) : [],
    status: r.status,
    lastSeenAt: r.last_seen_at,
    online: r.last_seen_at != null && now() - r.last_seen_at < 45_000,
    createdAt: r.created_at,
  };
}

export function createLocalAgentsRepo(db) {
  return {
    create({ id, userId, name, tokenHash, roots }) {
      db.run('INSERT INTO local_agents (id, user_id, name, token_hash, roots, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id,
        userId,
        name,
        tokenHash,
        roots || null,
        'active',
        now(),
      ]);
      return this.get(userId, id);
    },
    get(userId, id) {
      const r = db.get('SELECT * FROM local_agents WHERE user_id = ? AND id = ?', [userId, id]);
      return r ? rowToAgent(r) : null;
    },
    list(userId) {
      return db.all('SELECT * FROM local_agents WHERE user_id = ? ORDER BY created_at DESC', [userId]).map(rowToAgent);
    },
    
    findByTokenHash(tokenHash) {
      const r = db.get('SELECT * FROM local_agents WHERE token_hash = ? AND status = ?', [tokenHash, 'active']);
      return r ? rowToAgent(r) : null;
    },
    touch(id) {
      db.run('UPDATE local_agents SET last_seen_at = ? WHERE id = ?', [now(), id]);
    },
    revoke(userId, id) {
      db.run("UPDATE local_agents SET status = 'revoked' WHERE user_id = ? AND id = ?", [userId, id]);
    },
    delete(userId, id) {
      db.run('DELETE FROM local_agents WHERE user_id = ? AND id = ?', [userId, id]);
    },
  };
}
