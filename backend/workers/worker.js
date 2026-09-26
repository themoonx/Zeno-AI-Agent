


import crypto from 'node:crypto';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

const log = logger('worker');
const WORKER_ID = `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

const PROCESSORS = new Map();

export function registerProcessor(type, fn) {
  PROCESSORS.set(type, fn);
}

export function createWorkerLoop({ repos, telemetry }) {
  let running = false;
  let stopped = false;
  let active = 0;

  async function tick() {
    if (stopped) return;
    if (active >= config.workers.concurrency) return;
    let job = null;
    try {
      job = repos.ops.claimNext(WORKER_ID, [...PROCESSORS.keys()]);
    } catch (err) {
      log.error(`claim failed: ${err.message}`);
      return;
    }
    if (!job) return;

    active++;
    const processor = PROCESSORS.get(job.type);
    try {
      log.debug(`job #${job.seq} ${job.type} (attempt ${job.attempts})`);
      const result = await processor(job.payload, { userId: job.userId, job });
      repos.ops.completeJob(job.seq, result || { ok: true });
    } catch (err) {
      log.warn(`job #${job.seq} ${job.type} failed: ${err.message}`, { stack: err.stack });
      repos.ops.failJob(job.seq, err.message);
      
      
      const willRetry = Number(job.attempts || 1) < Number(job.maxAttempts || 3);
      if (willRetry) {
        telemetry?.retry({ userId: job.userId, sessionId: null, attempt: Number(job.attempts || 1), error: err.message });
      } else {
        telemetry?.failure({ userId: job.userId, sessionId: null, runId: job.payload?.runId || null, where: `job:${job.type}`, error: err.message });
      }
    } finally {
      active--;
      
      setImmediate(tick);
    }
  }

  function start() {
    if (running) return;
    running = true;
    stopped = false;
    log.info(`worker ${WORKER_ID} started (concurrency ${config.workers.concurrency})`);
    const interval = setInterval(async () => {
      if (!stopped) await tick();
    }, config.workers.pollMs);
    interval.unref();
  }

  function stop() {
    stopped = true;
  }

  return { start, stop, tick };
}
