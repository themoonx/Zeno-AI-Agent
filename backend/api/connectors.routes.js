import { Router } from 'express';
import { validate } from '../core/validate.js';

export function createConnectorRoutes({ connectors }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json({ connectors: await connectors.list(req.auth.userId) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const connector = await connectors.create(req.auth.userId, req.body || {});
      res.status(201).json({ connector });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      res.json({ connector: await connectors.get(req.auth.userId, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const connector = await connectors.update(req.auth.userId, req.params.id, req.body || {});
      res.json({ connector });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/enabled', async (req, res, next) => {
    try {
      const body = validate(req.body, { enabled: { type: 'boolean', required: true } });
      res.json({ connector: await connectors.setEnabled(req.auth.userId, req.params.id, body.enabled) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      res.json(await connectors.remove(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/discover', async (req, res, next) => {
    try {
      res.json(await connectors.discover(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      res.json(await connectors.discover(req.auth.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
