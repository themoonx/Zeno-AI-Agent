


import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';

const log = logger('telemetry');

export function createTelemetry({ repos }) {
  function record({ userId, sessionId = null, runId = null, turnId = null, callId = null, kind, fields = {} }) {
    try {
      repos.ops.recordTelemetry({ id: randomId('tel'), userId, sessionId, runId, turnId, callId, kind, fields });
    } catch (err) {
      log.debug(`telemetry write failed: ${err.message}`);
    }
  }

  return {
    record,
    modelCall({ userId, sessionId, runId, turnId, model, provider, promptTokens, completionTokens, latencyMs, ok = true, error = null }) {
      record({ userId, sessionId, runId, turnId, kind: 'model.call', fields: { model, provider, promptTokens, completionTokens, latencyMs, ok, error: error?.slice(0, 200) } });
    },
    toolExec({ userId, sessionId, runId, tool, ok, durationMs, callId, error = null }) {
      record({ userId, sessionId, runId, callId, kind: 'tool.exec', fields: { tool, ok, durationMs, error: error?.slice(0, 200) } });
    },
    permissionDecision({ userId, sessionId, runId, tool, decision, reason }) {
      record({ userId, sessionId, runId, kind: 'permission.decision', fields: { tool, decision, reason: reason?.slice(0, 200) } });
    },
    retry({ userId, sessionId, attempt, error }) {
      record({ userId, sessionId, kind: 'retry', fields: { attempt, error: error?.slice(0, 200) } });
    },
    failure({ userId, sessionId, runId, where, error }) {
      record({ userId, sessionId, runId, kind: 'failure', fields: { where, error: error?.slice(0, 300) } });
    },
    subagent({ userId, sessionId, subSessionId, tokens, ok }) {
      record({ userId, sessionId, kind: 'subagent.usage', fields: { subSessionId, tokens, ok } });
    },
    schedulerRun({ userId, sessionId, scheduleId, ok, durationMs }) {
      record({ userId, sessionId, kind: 'scheduler.run', fields: { scheduleId, ok, durationMs } });
    },
    snapshotOp({ userId, sessionId, op, snapshotId, files }) {
      record({ userId, sessionId, kind: 'snapshot.op', fields: { op, snapshotId, files } });
    },
    summary: (userId, { sinceMs = 24 * 3600 * 1000 } = {}) => repos.ops.telemetrySummary(userId, { sinceMs }),
  };
}