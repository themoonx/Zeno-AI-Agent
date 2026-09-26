import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';

export function createProjectRoutes({ repos }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ projects: repos.projects.listProjects(req.auth.userId) });
  });

  router.post('/', (req, res, next) => {
    try {
      const body = validate(req.body, {
        name: { type: 'string', required: true, min: 1, max: 120 },
        description: { type: 'string', max: 2000 },
        systemPrompt: { type: 'string', max: 8000 },
        color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: 'color must be a hex value like #4ADE9C' },
      });
      const id = randomId('proj');
      repos.projects.createProject({ id, userId: req.auth.userId, ...body });
      res.status(201).json({ project: repos.projects.getProject(req.auth.userId, id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const project = repos.projects.getProject(req.auth.userId, req.params.id);
      if (!project) throw errors.notFound('Project');
      res.json({ project });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const project = repos.projects.getProject(req.auth.userId, req.params.id);
      if (!project) throw errors.notFound('Project');
      const body = validate(req.body, {
        name: { type: 'string', min: 1, max: 120 },
        description: { type: 'string', max: 2000 },
        systemPrompt: { type: 'string', max: 8000 },
        color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/ },
      });
      repos.projects.updateProject(req.auth.userId, project.id, body);
      res.json({ project: repos.projects.getProject(req.auth.userId, project.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const project = repos.projects.getProject(req.auth.userId, req.params.id);
      if (!project) throw errors.notFound('Project');
      repos.projects.deleteProject(req.auth.userId, project.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createAgentRoutes({ repos, runs }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ agents: repos.agents.listAgents(req.auth.userId) });
  });

  router.post('/', (req, res, next) => {
    try {
      const body = validate(req.body, {
        name: { type: 'string', required: true, min: 1, max: 80 },
        description: { type: 'string', max: 2000 },
        systemPrompt: { type: 'string', max: 8000 },
        model: { type: 'object' },
        allowedTools: { type: 'array', items: { type: 'string' } },
        maxSteps: { type: 'number', min: 1, max: 200 },
        projectId: { type: 'string', max: 64 },
      });
      if (body.model?.modelId && !repos.providers.getModel(req.auth.userId, body.model.modelId)) {
        throw errors.notFound('Model');
      }
      const id = randomId('agent');
      repos.agents.createAgent({ id, userId: req.auth.userId, ...body });
      res.status(201).json({ agent: repos.agents.getAgent(req.auth.userId, id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const agent = repos.agents.getAgent(req.auth.userId, req.params.id);
      if (!agent) throw errors.notFound('Agent');
      res.json({ agent });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const agent = repos.agents.getAgent(req.auth.userId, req.params.id);
      if (!agent) throw errors.notFound('Agent');
      const body = validate(req.body, {
        name: { type: 'string', min: 1, max: 80 },
        description: { type: 'string', max: 2000 },
        systemPrompt: { type: 'string', max: 8000 },
        model: { type: 'object' },
        allowedTools: { type: 'array', items: { type: 'string' } },
        maxSteps: { type: 'number', min: 1, max: 200 },
        projectId: { type: 'string', max: 64 },
      });
      repos.agents.updateAgent(req.auth.userId, agent.id, body);
      res.json({ agent: repos.agents.getAgent(req.auth.userId, agent.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const agent = repos.agents.getAgent(req.auth.userId, req.params.id);
      if (!agent) throw errors.notFound('Agent');
      repos.agents.deleteAgent(req.auth.userId, agent.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  
  router.post('/:id/runs', async (req, res, next) => {
    try {
      const agent = repos.agents.getAgent(req.auth.userId, req.params.id);
      if (!agent) throw errors.notFound('Agent');
      const body = validate(req.body, { task: { type: 'string', required: true, min: 1, max: 8000 } });
      const run = await runs.startRun({ userId: req.auth.userId, agent, task: body.task });
      res.status(202).json({ run });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
