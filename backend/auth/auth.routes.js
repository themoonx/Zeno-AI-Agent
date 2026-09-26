import { Router } from 'express';
import { validate } from '../core/validate.js';
import { clientIp } from '../core/ratelimit.js';
import { setSessionCookie, clearSessionCookie, extractToken } from './middleware.js';

export function createAuthRoutes({ auth, rateLimiter }) {
  const router = Router();

  router.post('/register', rateLimiter, async (req, res, next) => {
    try {
      const body = validate(req.body, {
        email: { type: 'string', required: true, max: 200 },
        displayName: { type: 'string', required: true, min: 1, max: 60 },
        password: { type: 'string', required: true, min: 8, max: 200 },
      });
      const result = await auth.register(body, clientIp(req));
      setSessionCookie(res, result.token, result.expiresAt);
      res.status(201).json({ user: result.user, token: result.token, expiresAt: result.expiresAt });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', rateLimiter, async (req, res, next) => {
    try {
      const body = validate(req.body, {
        email: { type: 'string', required: true, max: 200 },
        password: { type: 'string', required: true, max: 200 },
      });
      const result = await auth.login(body, clientIp(req));
      setSessionCookie(res, result.token, result.expiresAt);
      res.json({ user: result.user, token: result.token, expiresAt: result.expiresAt });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    auth.logout(extractToken(req), req.auth?.userId, clientIp(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.auth) return res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in' } });
    res.json({ user: req.auth.user });
  });

  return router;
}
