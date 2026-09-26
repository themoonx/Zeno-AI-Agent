import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { PERMISSION_MODES } from '../harness/permissions.js';
import { encryptSecret, decryptSecret } from '../core/crypto.js';

const MEMORY_KINDS = ['fact', 'preference', 'project', 'agent', 'summary', 'episodic', 'semantic'];




const TIERS = ['local', 'fast', 'balanced', 'reasoning', 'premium'];
const VERIFY_LEVELS = ['none', 'basic', 'standard', 'strict'];

function shapeFor(key, value) {
  const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const strEnum = (v, allowed) => (allowed.includes(v) ? v : undefined);
  const boolOf = (v) => (typeof v === 'boolean' ? v : undefined);
  switch (key) {
    case 'jev': {
      const v = obj(value);
      if (!v) throw errors.badRequest('jev must be an object');
      const out = {};
      if (boolOf(v.enabled) !== undefined) out.enabled = v.enabled;
      if (v.endpoint !== undefined) {
        const endpoint = String(v.endpoint || '').trim();
        if (endpoint && !/^https?:\/\
        out.endpoint = endpoint;
      }
      if (strEnum(v.mode, ['json', 'openai']) !== undefined) out.mode = v.mode;
      if (v.model !== undefined) out.model = String(v.model || '').slice(0, 120);
      if (v.timeout_ms !== undefined) {
        const t = num(v.timeout_ms);
        if (t != null) out.timeout_ms = Math.max(250, Math.min(10_000, t));
      }
      if (v.confidence_floor !== undefined) {
        const c = Number(v.confidence_floor);
        if (!Number.isFinite(c) || c < 0 || c > 1) throw errors.badRequest('jev.confidence_floor must be between 0 and 1');
        out.confidence_floor = c;
      }
      if (boolOf(v.llm_fallback) !== undefined) out.llm_fallback = v.llm_fallback;
      if (v.api_key !== undefined) {
        
        const k = String(v.api_key || '');
        if (!k) out.api_key = null;
        else if (k.split('.').length === 4 && k.startsWith('v1.')) out.api_key = k;
        else out.api_key = encryptSecret(k);
      }
      return out;
    }
    case 'model_routing': {
      const v = obj(value);
      if (!v) throw errors.badRequest('model_routing must be an object');
      const out = {};
      if (v.mode !== undefined) {
        const mode = strEnum(v.mode, ['off', 'aux', 'full']);
        if (!mode) throw errors.badRequest('model_routing.mode must be one of: off, aux, full');
        out.mode = mode;
      }
      for (const t of ['planning_tier', 'compaction_tier', 'wrapup_tier', 'verification_tier']) {
        if (v[t] !== undefined) {
          const tier = strEnum(v[t], TIERS);
          if (!tier) throw errors.badRequest(`model_routing.${t} must be one of: ${TIERS.join(', ')}`);
          out[t] = tier;
        }
      }
      if (boolOf(v.learning) !== undefined) out.learning = v.learning;
      return out;
    }
    case 'cost_governor': {
      const v = obj(value);
      if (!v) throw errors.badRequest('cost_governor must be an object');
      const out = {};
      if (boolOf(v.enabled) !== undefined) out.enabled = v.enabled;
      for (const f of ['per_request_usd', 'per_day_usd', 'per_month_usd']) {
        if (v[f] !== undefined) {
          const n = v[f] === null ? null : num(v[f]);
          if (v[f] !== null && n == null) throw errors.badRequest(`cost_governor.${f} must be a positive number or null`);
          out[f] = n;
        }
      }
      const action = strEnum(v.action, ['downgrade', 'block']);
      if (action !== undefined) out.action = action;
      return out;
    }
    case 'verification': {
      const v = obj(value);
      if (!v) throw errors.badRequest('verification must be an object');
      const out = {};
      if (boolOf(v.enabled) !== undefined) out.enabled = v.enabled;
      if (v.minimum_level !== undefined) {
        const level = strEnum(v.minimum_level, VERIFY_LEVELS);
        if (!level) throw errors.badRequest(`verification.minimum_level must be one of: ${VERIFY_LEVELS.join(', ')}`);
        out.minimum_level = level;
      }
      return out;
    }
    case 'research': {
      const v = obj(value);
      if (!v) throw errors.badRequest('research must be an object');
      const out = {};
      if (boolOf(v.enabled) !== undefined) out.enabled = v.enabled;
      for (const f of ['max_subqueries', 'max_reads']) {
        if (v[f] !== undefined) {
          const n = num(v[f]);
          if (n == null || n > 6) throw errors.badRequest(`research.${f} must be a number between 0 and 6`);
          out[f] = Math.round(n);
        }
      }
      return out;
    }
    default:
      return undefined;
  }
}

export function createMemoryRoutes({ repos, memory }) {
  const router = Router();

  router.get('/', (req, res) => {
    const memories = repos.memory.list(req.auth.userId, {
      kind: req.query.kind || null,
      projectId: req.query.projectId || null,
      agentId: req.query.agentId || null,
      limit: Number(req.query.limit) || 200,
    });
    res.json({
      memories,
      embeddingConfigured: !!repos.users.getSetting(req.auth.userId, 'embedding_model'),
      stats: memory.stats(req.auth.userId),
    });
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = validate(req.body, {
        kind: { type: 'string', enum: MEMORY_KINDS, default: 'fact' },
        content: { type: 'string', required: true, min: 2, max: 4000 },
        projectId: { type: 'string', max: 64 },
        agentId: { type: 'string', max: 64 },
        importance: { type: 'number' },
      });
      const id = await memory.add({ userId: req.auth.userId, ...body, source: 'manual' });
      res.status(201).json({ memory: repos.memory.get(req.auth.userId, id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/search', async (req, res, next) => {
    try {
      const body = validate(req.body, { query: { type: 'string', required: true, min: 1, max: 500 } });
      const results = await memory.semanticSearch(req.auth.userId, body.query, { limit: 10 });
      res.json({
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          kind: r.kind || 'fact',
          score: Number(r.score.toFixed(4)),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  
  
  router.post('/consolidate', async (req, res, next) => {
    try {
      const result = await memory.consolidate(req.auth.userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = validate(req.body, { content: { type: 'string', required: true, min: 2, max: 4000 } });
      const existing = repos.memory.get(req.auth.userId, req.params.id);
      if (!existing) throw errors.notFound('Memory');
      await memory.update(req.auth.userId, existing.id, body.content);
      res.json({ memory: repos.memory.get(req.auth.userId, existing.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const existing = repos.memory.get(req.auth.userId, req.params.id);
      if (!existing) throw errors.notFound('Memory');
      memory.delete(req.auth.userId, existing.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createSettingsRoutes({ repos, audit }) {
  const router = Router();

  router.get('/', (req, res) => {
    const settings = repos.users.getAllSettings(req.auth.userId);
    
    
    if (settings.jev && typeof settings.jev === 'object' && settings.jev.api_key) {
      settings.jev = { ...settings.jev, api_key: settings.jev.api_key ? '__set__' : null };
    }
    res.json({ settings });
  });

  router.patch('/', (req, res, next) => {
    try {
      const body = validate(req.body, { settings: { type: 'object', required: true } });
      for (const [key, value] of Object.entries(body.settings)) {
        if (!/^[a-z0-9_]{1,60}$/.test(key)) throw errors.badRequest(`Invalid setting key: ${key}`);
        if (key === 'permission_mode' && !PERMISSION_MODES.includes(value)) {
          throw errors.badRequest(`permission_mode must be one of: ${PERMISSION_MODES.join(', ')}`);
        }
        if (key === 'plan_mode' && typeof value !== 'boolean') {
          throw errors.badRequest('plan_mode must be a boolean');
        }
        const shaped = shapeFor(key, value);
        repos.users.setSetting(req.auth.userId, key, shaped === undefined ? value : shaped);
      }
      audit({ userId: req.auth.userId, action: 'settings.update', meta: { keys: Object.keys(body.settings) } });
      const settings = repos.users.getAllSettings(req.auth.userId);
      if (settings.jev && typeof settings.jev === 'object') {
        settings.jev = { ...settings.jev, api_key: settings.jev.api_key ? '__set__' : null };
      }
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/audit', (req, res) => {
    res.json({ entries: repos.ops.listAudit(req.auth.userId, { limit: Number(req.query.limit) || 100 }) });
  });

  return router;
}
