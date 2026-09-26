import { j, pj, now } from '../helpers.js';

export function createUsersRepo(db) {
  return {
    
    createUser({ id, email, displayName, passwordHash }) {
      db.run(
        'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, email.toLowerCase(), displayName, passwordHash, now()]
      );
    },
    getUserByEmail(email) {
      return db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
    },
    getUser(id) {
      return db.get('SELECT * FROM users WHERE id = ?', [id]);
    },
    countUsers() {
      return db.get('SELECT COUNT(*) AS c FROM users').c;
    },

    
    createSession({ tokenHash, userId, expiresAt, userAgent }) {
      db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)', [
        tokenHash,
        userId,
        now(),
        expiresAt,
        userAgent || null,
      ]);
    },
    getSession(tokenHash) {
      const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', [tokenHash]);
      if (!s) return null;
      if (s.expires_at < now()) {
        db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
        return null;
      }
      return s;
    },
    deleteSession(tokenHash) {
      db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    },
    listSessions(userId) {
      return db
        .all('SELECT token_hash, created_at, expires_at, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC', [userId, now()])
        .map((r) => ({
          id: r.token_hash,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          userAgent: r.user_agent,
        }));
    },
    deleteExpiredSessions() {
      db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
    },

    
    getSetting(userId, key) {
      const row = db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, key]);
      return row ? pj(row.value) : null;
    },
    setSetting(userId, key, value) {
      db.run(
        'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = ?',
        [userId, key, j(value), j(value)]
      );
    },
    getAllSettings(userId) {
      const rows = db.all('SELECT key, value FROM settings WHERE user_id = ?', [userId]);
      return Object.fromEntries(rows.map((r) => [r.key, pj(r.value)]));
    },
  };
}
