


import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { HARNESS_DEFAULTS } from '../harness/index.js';

export function createHarnessRoutes({ repos, harness, audit }) {
  const router = Router();

  
  router.get('/', async (req, res, next) => {
    try {
      res.json(await harness.snapshot(req.auth.userId));
    } catch (err) {
      next(err);
    }
  });

  router.get('/settings', (req, res) => {
    res.json({ settings: harness.settings(req.auth.userId), defaults: HARNESS_DEFAULTS });
  });

  router.patch('/settings', async (req, res, next) => {
    try {
      const body = validate(req.body, { settings: { type: 'object', required: true } });
      const next_ = { ...harness.settings(req.auth.userId) };
      if (typeof body.settings.auto_orchestrate === 'boolean') next_.auto_orchestrate = body.settings.auto_orchestrate;
      if (typeof body.settings.auto_skills === 'boolean') next_.auto_skills = body.settings.auto_skills;
      if (typeof body.settings.plugin_tools === 'boolean') next_.plugin_tools = body.settings.plugin_tools;
      if (typeof body.settings.connector_tools === 'boolean') next_.connector_tools = body.settings.connector_tools;
      if (body.settings.max_matched_skills !== undefined) {
        const n = Number(body.settings.max_matched_skills);
        if (!Number.isInteger(n) || n < 0 || n > 6) throw errors.badRequest('max_matched_skills must be an integer 0-6');
        next_.max_matched_skills = n;
      }
      if (body.settings.disabled_tools !== undefined) {
        if (!Array.isArray(body.settings.disabled_tools)) throw errors.badRequest('disabled_tools must be an array of tool names');
        
        
        
        const current = harness.settings(req.auth.userId);
        const { toolCatalog } = harness;
        const { catalog } = await toolCatalog(req.auth.userId, {
          settings: { ...current, disabled_tools: [] },
        });
        const known = new Set(catalog.keys());
        next_.disabled_tools = [...new Set(body.settings.disabled_tools.map((t) => String(t)))].filter((t) => known.has(t));
      }
      if (body.settings.disabled_skills !== undefined) {
        if (!Array.isArray(body.settings.disabled_skills)) throw errors.badRequest('disabled_skills must be an array of skill slugs');
        const known = new Set(harness.skillCatalog(req.auth.userId).map((s) => s.slug));
        next_.disabled_skills = [...new Set(body.settings.disabled_skills.map((s) => String(s)))].filter((s) => known.has(s));
      }
      repos.users.setSetting(req.auth.userId, 'harness', next_);
      audit({ userId: req.auth.userId, action: 'harness.settings', meta: { keys: Object.keys(body.settings) } });
      res.json({ settings: harness.settings(req.auth.userId), defaults: HARNESS_DEFAULTS });
    } catch (err) {
      next(err);
    }
  });

  
  router.get('/skills', (req, res) => {
    res.json({ skills: harness.skills.all(req.auth.userId) });
  });

  router.post('/skills', (req, res, next) => {
    try {
      res.status(201).json({ skill: harness.skills.create(req.auth.userId, req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/skills/:id', (req, res, next) => {
    try {
      res.json({ skill: harness.skills.get(req.auth.userId, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/skills/:id', (req, res, next) => {
    try {
      res.json({ skill: harness.skills.update(req.auth.userId, req.params.id, req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/skills/:id/enabled', (req, res, next) => {
    try {
      const body = validate(req.body, { enabled: { type: 'boolean', required: true } });
      res.json({ skill: harness.skills.setEnabled(req.auth.userId, req.params.id, body.enabled) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/skills/:id', (req, res, next) => {
    try {
      res.json(harness.skills.remove(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  
  router.post('/skills/match', async (req, res, next) => {
    try {
      const body = validate(req.body, { query: { type: 'string', required: true, min: 1, max: 2000 } });
      const prepared = await harness.prepareTurn({ userId: req.auth.userId, query: body.query });
      res.json({
        matched: prepared.plan.matchedSkills,
        offerTools: prepared.plan.offerTools,
        groups: prepared.plan.groups,
      });
    } catch (err) {
      next(err);
    }
  });

  
  router.get('/plugins', (req, res) => {
    res.json({ plugins: harness.plugins.list(req.auth.userId) });
  });

  router.post('/plugins', async (req, res, next) => {
    try {
      res.status(201).json({ plugin: await harness.plugins.create(req.auth.userId, req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/plugins/:id', (req, res, next) => {
    try {
      res.json({ plugin: harness.plugins.get(req.auth.userId, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/plugins/:id', async (req, res, next) => {
    try {
      res.json({ plugin: await harness.plugins.update(req.auth.userId, req.params.id, req.body || {}) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/plugins/:id/enabled', (req, res, next) => {
    try {
      const body = validate(req.body, { enabled: { type: 'boolean', required: true } });
      res.json({ plugin: harness.plugins.setEnabled(req.auth.userId, req.params.id, body.enabled) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/plugins/:id', (req, res, next) => {
    try {
      res.json(harness.plugins.remove(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/plugins/:id/test', async (req, res, next) => {
    try {
      res.json(await harness.plugins.test(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}