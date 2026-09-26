import { randomId, hashPassword, verifyPassword, newSessionToken, hashToken } from '../core/crypto.js';
import { errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { publish, topics } from '../core/eventbus.js';

const log = logger('auth');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function createAuthService({ repos, audit }) {
  return {
    async register({ email, displayName, password }, ip) {
      if (!EMAIL_RE.test(email)) throw errors.badRequest('Enter a valid email address');
      if (password.length < 8) throw errors.badRequest('Password must be at least 8 characters');
      if (displayName.length < 1 || displayName.length > 60) throw errors.badRequest('Display name must be 1–60 characters');

      const existing = repos.users.getUserByEmail(email);
      if (existing) throw errors.conflict('An account with this email already exists');

      const id = randomId('usr');
      repos.users.createUser({ id, email, displayName, passwordHash: hashPassword(password) });
      audit({ userId: id, action: 'auth.register', ip });

      const session = this._createSession(id);
      log.info(`Registered user ${email}`);
      return { user: { id, email, displayName }, ...session };
    },

    async login({ email, password }, ip) {
      const user = repos.users.getUserByEmail(email);
      
      if (!user || !verifyPassword(password, user.password_hash)) {
        audit({ userId: user?.id, action: 'auth.login_failed', ip, meta: { email } });
        throw errors.unauthorized('Invalid email or password');
      }
      audit({ userId: user.id, action: 'auth.login', ip });
      const session = this._createSession(user.id);
      return { user: { id: user.id, email: user.email, displayName: user.display_name }, ...session };
    },

    _createSession(userId) {
      const token = newSessionToken();
      const expiresAt = Date.now() + config.auth.sessionTtlMs;
      repos.users.createSession({ tokenHash: hashToken(token), userId, expiresAt });
      return { token, expiresAt };
    },

    verifySession(token) {
      if (!token) return null;
      const session = repos.users.getSession(hashToken(token));
      if (!session) return null;
      const user = repos.users.getUser(session.user_id);
      if (!user) return null;
      return { userId: user.id, user: { id: user.id, email: user.email, displayName: user.display_name } };
    },

    logout(token, userId, ip) {
      if (token) repos.users.deleteSession(hashToken(token));
      audit({ userId, action: 'auth.logout', ip });
    },

    notifyUser(userId, event) {
      publish(topics.userEvents(userId), event);
    },
  };
}
