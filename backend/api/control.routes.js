


import { Router } from 'express';
import crypto from 'node:crypto';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';
import { publish, topics } from '../core/eventbus.js';
import { PERMISSION_MODES, MODE_LABELS, MODE_DESCRIPTIONS } from '../harness/permissions.js';
import { getAgentRegistry } from '../realtime/registry.js';
import { localFsAvailable, localRootsHint } from '../tools/local-bridge.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createControlRoutes({ repos, audit, policy, runtimeControl, snapshots, policyReevaluator, telemetry }) {
  const router = Router();

  
  router.get('/permissions', (req, res) => {
    const stored = repos.users.getSetting(req.auth.userId, 'permission_mode');
    res.json({
      mode: PERMISSION_MODES.includes(stored) ? stored : 'ask',
      modes: PERMISSION_MODES.map((m) => ({ id: m, label: MODE_LABELS[m], description: MODE_DESCRIPTIONS[m] })),
      rules: repos.policy.list(req.auth.userId),
    });
  });

  router.post('/permissions/rules', (req, res, next) => {
    try {
      const body = validate(req.body, {
        subject: { type: 'string', required: true, min: 3, max: 300, pattern: /^[a-z.*][a-z0-9_.:*-]*:[\s\S]+$/i },
        effect: { type: 'string', required: true, enum: ['allow', 'ask', 'deny'] },
      });
      
      const cls = body.subject.split(':')[0].toLowerCase();
      const KNOWN = ['fs.read', 'fs.write', 'fs.delete', 'shell.exec', 'code.exec', 'net.read', 'net.request', 'memory.read', 'memory.write', 'mcp', 'plugin', 'plan', '*'];
      if (!KNOWN.includes(cls)) throw errors.badRequest(`Unknown action class "${cls}". Known: ${KNOWN.join(', ')}`);
      const rule = repos.policy.insert({ id: randomId('rule'), userId: req.auth.userId, subject: body.subject, effect: body.effect });
      audit({ userId: req.auth.userId, action: 'policy.rule.create', meta: { subject: body.subject, effect: body.effect } });
      
      publish(topics.userEvents(req.auth.userId), { type: 'policy.changed', userId: req.auth.userId });
      policyReevaluator?.reevaluatePending(req.auth.userId);
      res.status(201).json({ rule });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/permissions/rules/:id', (req, res, next) => {
    try {
      const rule = repos.policy.get(req.auth.userId, req.params.id);
      if (!rule) throw errors.notFound('Rule');
      repos.policy.delete(req.auth.userId, req.params.id);
      audit({ userId: req.auth.userId, action: 'policy.rule.delete', meta: { subject: rule.subject } });
      publish(topics.userEvents(req.auth.userId), { type: 'policy.changed', userId: req.auth.userId });
      policyReevaluator?.reevaluatePending(req.auth.userId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  
  router.post('/permissions/preview', async (req, res, next) => {
    try {
      const body = validate(req.body, {
        tool: { type: 'string', required: true, max: 64 },
        path: { type: 'string', max: 500 },
        mode: { type: 'string', enum: PERMISSION_MODES },
      });
      const tool = { name: body.tool, sensitive: true, workspaceSafe: body.tool.startsWith('file_'), connectorId: body.tool.startsWith('mcp_') ? body.tool : null };
      const verdict = await policy.evaluate({ userId: req.auth.userId, tool, args: body.path ? { path: body.path } : {}, mode: body.mode || repos.users.getSetting(req.auth.userId, 'permission_mode') || 'ask' });
      res.json({ decision: verdict.decision, reason: verdict.reason });
    } catch (err) {
      next(err);
    }
  });

  
  router.get('/environments', (req, res) => {
    const registry = getAgentRegistry();
    const agents = repos.localAgents.list(req.auth.userId).map((a) => ({ ...a, online: registry.isOnline(req.auth.userId, a.id) && a.status === 'active' }));
    res.json({
      agents,
      serverBridge: { enabled: localFsAvailable(req.auth.userId) && !agents.some((a) => a.online), hint: localRootsHint() },
    });
  });

  router.post('/environments/agents', (req, res, next) => {
    try {
      const body = validate(req.body, { name: { type: 'string', required: true, min: 1, max: 64 }, roots: { type: 'string', max: 2000 } });
      const token = `zla_${randomId('tok').replace(/^tok_/, '')}${crypto.randomBytes(16).toString('hex')}`;
      const agent = repos.localAgents.create({
        id: randomId('lag'),
        userId: req.auth.userId,
        name: body.name,
        tokenHash: hashToken(token),
        roots: body.roots || null,
      });
      audit({ userId: req.auth.userId, action: 'local_agent.pair', target: agent.id, meta: { name: body.name } });
      
      res.status(201).json({ agent, token, connect: `node local-agent/agent.js --server <this-server-url> --token ${token}` });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/environments/agents/:id', (req, res, next) => {
    try {
      const agent = repos.localAgents.get(req.auth.userId, req.params.id);
      if (!agent) throw errors.notFound('Local agent');
      repos.localAgents.revoke(req.auth.userId, req.params.id);
      audit({ userId: req.auth.userId, action: 'local_agent.revoke', target: agent.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  
  router.get('/security/sessions', (req, res) => {
    res.json({ sessions: repos.users.listSessions(req.auth.userId) });
  });

  router.delete('/security/sessions/:hash', (req, res) => {
    repos.users.deleteSession(req.params.hash);
    audit({ userId: req.auth.userId, action: 'security.session.revoke', target: req.params.hash.slice(0, 12) });
    res.json({ ok: true });
  });

  router.get('/security/audit', (req, res) => {
    res.json({ entries: repos.ops.listAudit(req.auth.userId, { limit: Number(req.query.limit) || 150 }) });
  });

  
  
  
  
  router.get('/telemetry', (req, res) => {
    const sinceMs = Math.min(30 * 24 * 3600 * 1000, Math.max(3600_000, Number(req.query.sinceHours || 24) * 3600_000));
    res.json({ sinceMs, summary: telemetry?.summary(req.auth.userId, { sinceMs }) || null });
  });

  return router;
}
