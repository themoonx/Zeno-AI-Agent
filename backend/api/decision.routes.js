



import { Router } from 'express';
import { errors } from '../core/errors.js';
import { allToolDescriptors } from '../tools/registry.js';

export function createDecisionRoutes({ repos, decision, modelRouter, costGovernor }) {
  const decisionRouter = Router();

  
  decisionRouter.get('/preview', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').slice(0, 2000);
      if (!q.trim()) throw errors.badRequest('q is required');
      const toolNames = new Set(allToolDescriptors().map((t) => t.name));
      const result = await decision.preview({ userId: req.auth.userId, query: q, kind: 'chat', hasTools: true, toolNames, hasAttachments: false });
      res.json({
        ...result,
        tiers: modelRouter ? modelRouter.tierMap(req.auth.userId) : {},
        routing: modelRouter ? modelRouter.routingConfig(req.auth.userId) : { mode: 'off' },
      });
    } catch (err) {
      next(err);
    }
  });

  
  decisionRouter.get('/stats', (req, res) => {
    res.json({ stats: decision.stats(req.auth.userId) });
  });

  
  decisionRouter.post('/stats/reset', (req, res) => {
    decision.resetStats(req.auth.userId);
    res.json({ ok: true });
  });

  const costRouter = Router();
  
  costRouter.get('/summary', (req, res) => {
    const summary = costGovernor
      ? costGovernor.summary(req.auth.userId)
      : { budgets: null, today: { cost: 0, requests: 0 }, month: { cost: 0, requests: 0 }, byDay: [], byModel: [] };
    const pricing = {};
    if (modelRouter) {
      for (const m of repos.providers.listModels(req.auth.userId)) {
        pricing[m.id] = costGovernor?.priceFor(m) || null;
      }
    }
    res.json({ ...summary, pricing });
  });

  return { decisionRouter, costRouter };
}
