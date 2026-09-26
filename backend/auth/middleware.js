import { errors } from '../core/errors.js';

const COOKIE_NAME = 'zeno_session';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

export function createAuthMiddleware(auth) {
  
  const attach = (req, _res, next) => {
    try {
      req.auth = auth.verifySession(extractToken(req));
    } catch {
      req.auth = null;
    }
    next();
  };

  const requireAuth = (req, res, next) => {
    attach(req, res, () => {
      if (!req.auth) throw errors.unauthorized();
      next();
    });
  };

  const optionalAuth = attach;

  return { requireAuth, optionalAuth };
}
