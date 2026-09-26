

















import crypto from 'node:crypto';
import { logger } from '../core/logger.js';
import { classify, coerceDecision } from './heuristics.js';
import { createRemoteDecisionProvider } from './remote.js';

const log = logger('decision');

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
const DEFAULT_CONFIDENCE_FLOOR = 0.6;

export const FAILURE_CLASSES = ['TRANSIENT', 'RATE_LIMIT', 'NETWORK', 'AUTH', 'INVALID_ARGUMENT', 'TOOL_FAILURE', 'MODEL_FAILURE', 'LOGIC_FAILURE', 'PERMISSION', 'UNKNOWN'];



const RETRYABLE = new Set(['TRANSIENT', 'RATE_LIMIT', 'NETWORK', 'MODEL_FAILURE']);

export function classifyError(err) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || err || '').toLowerCase();
  if (err?.name === 'AbortError') return 'ABORT';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402 || status === 407) return 'PERMISSION';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 408 || status === 504) return 'NETWORK';
  if (status >= 500) return 'TRANSIENT';
  if (/\brate.?limit|too many requests|quota\b/.test(msg)) return 'RATE_LIMIT';
  if (/\b(econnreset|etimedout|econnrefused|enotfound|ehostunreach|enetunreach|fetch failed|socket hang up|network|dns|timeout)\b/.test(msg)) return 'NETWORK';
  if (/\b(unauthor|forbidden|api key|invalid_api_key|authentication)\b/.test(msg)) return 'AUTH';
  if (/\b(invalid|unsupported|unexpected|malformed|schema|does not support|not a valid)\b[^.]*\b(parameter|argument|field|value|model|request)\b/.test(msg) || /\binvalid request\b/.test(msg)) return 'INVALID_ARGUMENT';
  if (/\b(overloaded|capacity|temporarily|try again|internal server error|bad gateway|service unavailable)\b/.test(msg)) return 'TRANSIENT';
  if (/\btool\b|\bcapability\b|\bexecutor\b/.test(msg)) return 'TOOL_FAILURE';
  if (/\b(context length|maximum context|too long|token limit)\b/.test(msg)) return 'INVALID_ARGUMENT';
  return 'UNKNOWN';
}

export function createDecisionEngine({ repos }) {
  const cache = new Map(); 

  function jevSettings(userId) {
    const stored = repos.users.getSetting(userId, 'jev') || {};
    const s = typeof stored === 'object' ? stored : {};
    return {
      enabled: s.enabled !== false,
      confidence_floor: Number.isFinite(Number(s.confidence_floor)) ? Math.max(0, Math.min(1, Number(s.confidence_floor))) : DEFAULT_CONFIDENCE_FLOOR,
      remote: s,
    };
  }

  function remoteProviderFor(userId, settings) {
    try {
      return createRemoteDecisionProvider({ settings: settings.remote });
    } catch {
      return null;
    }
  }

  function cacheKey(userId, query, opts) {
    const norm = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
    return crypto.createHash('sha256').update(`${userId}|${opts.kind}|${opts.hasTools ? 1 : 0}|${opts.hasAttachments ? 1 : 0}|${norm}`).digest('hex').slice(0, 32);
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      cache.delete(key);
      return null;
    }
    return hit.value;
  }

  function cachePut(key, value) {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  }

  
  async function decideTurn({ userId, query, kind = 'chat', hasTools = true, toolNames = new Set(), hasAttachments = false }) {
    const settings = jevSettings(userId);
    const opts = { kind, hasTools, hasAttachments };
    if (!settings.enabled) return null;

    const key = cacheKey(userId, query, opts);
    const cached = cacheGet(key);
    if (cached) return { ...cached, cached: true };

    const started = Date.now();
    const fallback = classify(query, { hasTools, toolNames, hasAttachments, kind });

    let decision = null;
    let source = fallback.source;
    const remote = remoteProviderFor(userId, settings);
    if (remote?.configured) {
      const raw = await remote.decide({ query, context: { kind, hasTools, hasAttachments, toolNames: [...toolNames].slice(0, 40) } });
      if (raw) {
        decision = coerceDecision(raw, fallback);
        source = `remote:${remote.mode}`;
        decision.source = source;
      }
    }
    if (!decision) decision = { ...fallback };
    decision.decisionMs = Date.now() - started;

    cachePut(key, decision);
    return decision;
  }

  
  async function preview({ userId, query, kind = 'chat', hasTools = true, toolNames = new Set(), hasAttachments = false }) {
    const decision = await decideTurn({ userId, query, kind, hasTools, toolNames, hasAttachments });
    const settings = jevSettings(userId);
    return {
      decision,
      willRouteAgent: !!decision && (decision.executionMode === 'agent' || decision.confidence < settings.confidence_floor),
      confidenceFloor: settings.confidence_floor,
      remoteConfigured: !!remoteProviderFor(userId, settings)?.configured,
    };
  }

  
  function retryPlan({ failureClass, attempt = 0, maxAttempts = 2, baseDelayMs = 500, maxDelayMs = 8000 }) {
    if (!RETRYABLE.has(failureClass)) return { action: 'abort', delayMs: 0, failureClass };
    if (attempt >= maxAttempts) return { action: 'escalate', delayMs: 0, failureClass };
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const delayMs = Math.round(exp * (0.7 + 0.6 * Math.random()));
    return { action: 'retry', delayMs, failureClass };
  }

  
  
  
  
  function recordOutcome({ userId, taskType = 'general', decisionMs = 0, tokens = 0, estCostUsd = 0, escalated = false, failed = false }) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const row = repos.intelligence.getRoutingStatsRow(userId, day, taskType);
      if (!row) {
        repos.intelligence.insertRoutingStats({ userId, day, taskType, turns: 1, escalations: escalated ? 1 : 0, failures: failed ? 1 : 0, decisionMsTotal: decisionMs, tokensTotal: tokens, estCostTotal: estCostUsd });
      } else {
        repos.intelligence.updateRoutingStats(row.id, {
          turns: row.turns + 1,
          escalations: row.escalations + (escalated ? 1 : 0),
          failures: row.failures + (failed ? 1 : 0),
          decisionMsTotal: row.decision_ms_total + decisionMs,
          tokensTotal: row.tokens_total + tokens,
          estCostTotal: row.est_cost_total + estCostUsd,
        });
      }
    } catch (err) {
      log.debug(`routing stats write failed: ${err.message}`);
    }
  }

  
  function tierBias(userId, taskType) {
    try {
      const rows = repos.intelligence.routingStats(userId, { days: 7 });
      const agg = rows.filter((r) => r.task_type === taskType && r.turns >= 5);
      if (!agg.length) return 0;
      const turns = agg.reduce((a, r) => a + r.turns, 0);
      const bad = agg.reduce((a, r) => a + r.escalations + r.failures, 0);
      return bad / turns > 0.4 ? 1 : 0;
    } catch {
      return 0;
    }
  }

  function stats(userId) {
    const rows = repos.intelligence.routingStats(userId, { days: 14 });
    return rows.map((r) => ({
      day: r.day,
      taskType: r.task_type,
      turns: r.turns,
      escalations: r.escalations,
      failures: r.failures,
      avgDecisionMs: r.turns ? Math.round(r.decision_ms_total / r.turns) : 0,
      tokens: r.tokens_total,
      estCostUsd: Number(r.est_cost_total.toFixed(6)),
    }));
  }

  function resetStats(userId) {
    repos.intelligence.resetRoutingStats(userId);
    cache.clear();
  }

  return { decideTurn, preview, classifyError, retryPlan, recordOutcome, tierBias, stats, resetStats, FAILURE_CLASSES };
}
