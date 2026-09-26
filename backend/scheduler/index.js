


import { randomId } from '../core/crypto.js';
import { j, pj, now } from '../database/helpers.js';
import { nextRun } from './cron.js';
import { logger } from '../core/logger.js';

const log = logger('scheduler');

function rowToSchedule(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    cron: r.cron,
    task: r.task,
    enabled: !!r.enabled,
    projectId: r.project_id,
    modelId: r.model_id,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    maxConcurrent: r.max_concurrent ?? 1,
    maxRetries: r.max_retries ?? 2,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createSchedulesRepo(db) {
  return {
    create({ id, userId, name, cron, task, projectId = null, modelId = null, maxConcurrent = 1, maxRetries = 2, nextRunAt }) {
      const t = now();
      db.run(
        'INSERT INTO schedules (id, user_id, name, cron, task, enabled, project_id, model_id, next_run_at, max_concurrent, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)',
        [id, userId, name, cron, task, projectId, modelId, nextRunAt, maxConcurrent, maxRetries, t, t]
      );
      return this.get(userId, id);
    },
    get(userId, id) {
      const r = db.get('SELECT * FROM schedules WHERE user_id = ? AND id = ?', [userId, id]);
      return r ? rowToSchedule(r) : null;
    },
    list(userId) {
      return db.all('SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC', [userId]).map(rowToSchedule);
    },
    update(userId, id, fields) {
      const map = { name: 'name', cron: 'cron', task: 'task', enabled: 'enabled', projectId: 'project_id', modelId: 'model_id', nextRunAt: 'next_run_at', lastRunAt: 'last_run_at', lastStatus: 'last_status', maxConcurrent: 'max_concurrent', maxRetries: 'max_retries' };
      const sets = ['updated_at = ?'];
      const params = [now()];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        let v = fields[k];
        if (col === 'enabled') v = v ? 1 : 0;
        sets.push(`${col} = ?`);
        params.push(v);
      }
      if (sets.length <= 1) return;
      params.push(userId, id);
      db.run(`UPDATE schedules SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`, params);
    },
    delete(userId, id) {
      db.run('DELETE FROM schedules WHERE user_id = ? AND id = ?', [userId, id]);
    },
    
    claimDue(scheduleId, scheduledFor, workerId) {
      const claimed = db.run(
        'UPDATE schedules SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ? AND next_run_at = ? AND enabled = 1',
        [now(), 'claimed', now(), scheduleId, scheduledFor]
      );
      return claimed.changes === 1;
    },
    runsFor(scheduleId) {
      return db.all('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 50', [scheduleId]).map((r) => ({
        id: r.id, scheduleId: r.schedule_id, scheduledFor: r.scheduled_for, runId: r.run_id, sessionId: r.session_id, status: r.status, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at,
      }));
    },
    recentRuns(userId, { limit = 100 } = {}) {
      return db.all('SELECT * FROM schedule_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]).map((r) => ({
        id: r.id, scheduleId: r.schedule_id, scheduledFor: r.scheduled_for, runId: r.run_id, sessionId: r.session_id, status: r.status, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at,
      }));
    },
    countActive(scheduleId) {
      return Number(db.get("SELECT COUNT(*) AS c FROM schedule_runs WHERE schedule_id = ? AND status IN ('queued','running')", [scheduleId]).c);
    },
    
    due() {
      return db.all('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC', [now()]).map(rowToSchedule);
    },
    insertRun({ id, scheduleId, userId, scheduledFor }) {
      db.run(
        "INSERT INTO schedule_runs (id, schedule_id, user_id, scheduled_for, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)",
        [id, scheduleId, userId, scheduledFor, now()]
      );
    },
    updateRun(id, fields) {
      const map = { runId: 'run_id', sessionId: 'session_id', status: 'status', error: 'error', finishedAt: 'finished_at' };
      const sets = [];
      const params = [];
      for (const [k, col] of Object.entries(map)) {
        if (fields[k] === undefined) continue;
        sets.push(`${col} = ?`);
        params.push(fields[k]);
      }
      if (!sets.length) return;
      params.push(id);
      db.run(`UPDATE schedule_runs SET ${sets.join(', ')} WHERE id = ?`, params);
    },
  };
}

export function createScheduler({ repos, kernel, runsService, telemetry, audit }) {
  let timer = null;
  let ticking = false;

  function computeNext(cronExpr) {
    return nextRun(cronExpr, new Date());
  }

  async function tick(workerId = 'scheduler') {
    if (ticking) return;
    ticking = true;
    try {
      const due = repos.schedules.due();
      for (const schedule of due) {
        
        if (repos.schedules.countActive(schedule.id) >= (schedule.maxConcurrent || 1)) {
          repos.schedules.update(schedule.userId, schedule.id, { nextRunAt: computeNext(schedule.cron), lastStatus: 'skipped-concurrency' });
          continue;
        }
        
        const scheduledFor = schedule.nextRunAt;
        if (!repos.schedules.claimDue(schedule.id, scheduledFor, workerId)) continue;
        repos.schedules.update(schedule.userId, schedule.id, { nextRunAt: computeNext(schedule.cron) });

        
        const occurrenceId = `scr_${randomId('occ').replace(/^occ_/, '')}`;
        try {
          repos.schedules.insertRun({ id: occurrenceId, scheduleId: schedule.id, userId: schedule.userId, scheduledFor });
        } catch (err) {
          log.warn(`schedule occurrence already recorded — skipping duplicate run (${schedule.name})`);
          continue;
        }

        
        
        try {
          const run = await runsService.startRun({ userId: schedule.userId, agent: { name: `Schedule: ${schedule.name}`, projectId: schedule.projectId }, task: schedule.task });
          repos.schedules.updateRun(occurrenceId, { runId: run.id, status: 'running' });
          audit({ userId: schedule.userId, action: 'scheduler.run', target: schedule.id, meta: { runId: run.id, scheduledFor } });
          telemetry?.schedulerRun({ userId: schedule.userId, scheduleId: schedule.id, ok: true, durationMs: 0 });
        } catch (err) {
          repos.schedules.updateRun(occurrenceId, { status: 'failed', error: String(err.message || err).slice(0, 300) });
          repos.schedules.update(schedule.userId, schedule.id, { lastStatus: 'failed' });
          telemetry?.schedulerRun({ userId: schedule.userId, scheduleId: schedule.id, ok: false, durationMs: 0 });
          log.warn(`scheduled run failed to start (${schedule.name}): ${err.message}`);
        }
      }
    } catch (err) {
      log.warn(`scheduler tick failed: ${err.message}`);
    } finally {
      ticking = false;
    }
  }

  function start({ intervalMs = 30_000 } = {}) {
    stop();
    timer = setInterval(() => tick(), intervalMs);
    timer.unref?.();
    log.info(`scheduler started (tick ${intervalMs}ms)`);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { tick, start, stop, computeNext };
}