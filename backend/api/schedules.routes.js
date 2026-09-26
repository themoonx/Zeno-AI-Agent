




import { Router } from 'express';
import { validate } from '../core/validate.js';
import { errors } from '../core/errors.js';
import { randomId } from '../core/crypto.js';
import { nextRun } from '../scheduler/cron.js';

function computeNext(cron) {
  try {
    return nextRun(cron, new Date());
  } catch (err) {
    throw errors.badRequest(`Invalid cron expression: ${err.message}`);
  }
}

export function createScheduleRoutes({ repos, runs, audit }) {
  const router = Router();

  router.get('/', (req, res) => {
    const schedules = repos.schedules.list(req.auth.userId);
    res.json({ schedules, recentRuns: repos.schedules.recentRuns(req.auth.userId, { limit: 50 }) });
  });

  router.post('/', (req, res, next) => {
    try {
      const body = validate(req.body, {
        name: { type: 'string', required: true, min: 1, max: 120 },
        cron: { type: 'string', required: true, min: 9, max: 100 },
        task: { type: 'string', required: true, min: 1, max: 8000 },
        projectId: { type: 'string', max: 64 },
        modelId: { type: 'string', max: 64 },
        maxConcurrent: { type: 'integer', min: 1, max: 4 },
        maxRetries: { type: 'integer', min: 0, max: 10 },
      });
      const nextRunAt = computeNext(body.cron);
      const schedule = repos.schedules.create({
        id: randomId('sched'),
        userId: req.auth.userId,
        name: body.name,
        cron: body.cron,
        task: body.task,
        projectId: body.projectId || null,
        modelId: body.modelId || null,
        maxConcurrent: body.maxConcurrent ?? 1,
        maxRetries: body.maxRetries ?? 2,
        nextRunAt,
      });
      audit({ userId: req.auth.userId, action: 'schedule.create', target: schedule.id, meta: { cron: body.cron } });
      res.status(201).json({ schedule });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const existing = repos.schedules.get(req.auth.userId, req.params.id);
      if (!existing) throw errors.notFound('Schedule');
      const body = validate(req.body, {
        name: { type: 'string', min: 1, max: 120 },
        cron: { type: 'string', min: 9, max: 100 },
        task: { type: 'string', min: 1, max: 8000 },
        enabled: { type: 'boolean' },
        projectId: { type: 'string', max: 64 },
        modelId: { type: 'string', max: 64 },
        maxConcurrent: { type: 'integer', min: 1, max: 4 },
        maxRetries: { type: 'integer', min: 0, max: 10 },
      });
      const fields = { ...body };
      if (body.cron && body.cron !== existing.cron) {
        fields.nextRunAt = computeNext(body.cron);
      }
      repos.schedules.update(req.auth.userId, req.params.id, fields);
      audit({ userId: req.auth.userId, action: 'schedule.update', target: req.params.id, meta: { fields: Object.keys(fields) } });
      res.json({ schedule: repos.schedules.get(req.auth.userId, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const existing = repos.schedules.get(req.auth.userId, req.params.id);
      if (!existing) throw errors.notFound('Schedule');
      repos.schedules.delete(req.auth.userId, req.params.id);
      audit({ userId: req.auth.userId, action: 'schedule.delete', target: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/runs', (req, res, next) => {
    try {
      const existing = repos.schedules.get(req.auth.userId, req.params.id);
      if (!existing) throw errors.notFound('Schedule');
      res.json({ schedule: existing, runs: repos.schedules.runsFor(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  
  
  router.post('/:id/trigger', async (req, res, next) => {
    try {
      const schedule = repos.schedules.get(req.auth.userId, req.params.id);
      if (!schedule) throw errors.notFound('Schedule');
      if (repos.schedules.countActive(schedule.id) >= (schedule.maxConcurrent || 1)) {
        throw errors.conflict('This schedule already has the maximum number of concurrent runs.');
      }
      const occurrenceId = randomId('occ').replace(/^occ_/, '');
      repos.schedules.insertRun({ id: occurrenceId, scheduleId: schedule.id, userId: req.auth.userId, scheduledFor: Date.now() });
      try {
        const run = await runs.startRun({ userId: req.auth.userId, agent: { name: `Schedule: ${schedule.name}`, projectId: schedule.projectId }, task: schedule.task });
        repos.schedules.updateRun(occurrenceId, { runId: run.id, status: 'running' });
        audit({ userId: req.auth.userId, action: 'schedule.trigger', target: schedule.id, meta: { runId: run.id } });
        res.status(202).json({ ok: true, runId: run.id, occurrenceId });
      } catch (err) {
        repos.schedules.updateRun(occurrenceId, { status: 'failed', error: String(err.message || err).slice(0, 300), finishedAt: Date.now() });
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
