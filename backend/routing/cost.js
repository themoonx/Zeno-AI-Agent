



















import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';

const log = logger('cost');




const BUILTIN_PRICING = [
  [/gpt-4o-mini/i, { in: 0.15, out: 0.6 }],
  [/gpt-4o/i, { in: 2.5, out: 10 }],
  [/gpt-4\.1-mini/i, { in: 0.4, out: 1.6 }],
  [/gpt-4\.1-nano/i, { in: 0.1, out: 0.4 }],
  [/gpt-4\.1/i, { in: 2, out: 8 }],
  [/gpt-3\.5/i, { in: 0.5, out: 1.5 }],
  [/o4-mini/i, { in: 1.1, out: 4.4 }],
  [/o3-mini/i, { in: 1.1, out: 4.4 }],
  [/(^|[-_.])o[134]([-_.]|$)/i, { in: 2, out: 8 }],
  [/claude-(opus|4-opus|sonnet-4-5)/i, { in: 15, out: 75 }],
  [/claude-sonnet/i, { in: 3, out: 15 }],
  [/claude-haiku/i, { in: 0.8, out: 4 }],
  [/gemini-2\.5-pro/i, { in: 1.25, out: 10 }],
  [/gemini-.*flash/i, { in: 0.3, out: 2.5 }],
  [/gemini-.*pro/i, { in: 1.25, out: 10 }],
  [/deepseek-reasoner/i, { in: 0.55, out: 2.19 }],
  [/deepseek/i, { in: 0.27, out: 1.1 }],
  [/grok-4/i, { in: 3, out: 15 }],
  [/mistral|mixtral/i, { in: 0.5, out: 1.5 }],
  [/qwen/i, { in: 0.4, out: 1.2 }],
  [/llama/i, { in: 0.35, out: 0.4 }],
];

const ZERO = { in: 0, out: 0 };


export function priceFor(modelRow, providerKind = null) {
  const p = modelRow?.params?.pricing;
  if (p && Number.isFinite(Number(p.inputPerMTok)) && Number.isFinite(Number(p.outputPerMTok))) {
    return { in: Number(p.inputPerMTok), out: Number(p.outputPerMTok), source: 'user' };
  }
  if (providerKind === 'ollama') return { ...ZERO, source: 'local' };
  const id = String(modelRow?.modelId || '');
  for (const [re, price] of BUILTIN_PRICING) {
    if (re.test(id)) return { ...price, source: 'builtin' };
  }
  return { ...ZERO, source: 'unknown' };
}

export function estimateCost(modelRow, { promptTokens = 0, completionTokens = 0 }, providerKind = null) {
  const price = priceFor(modelRow, providerKind);
  const usd = (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out;
  return { usd, priceSource: price.source };
}

export function createCostGovernor({ repos }) {
  
  
  const dayCache = new Map(); 

  function settingsFor(userId) {
    const stored = repos.users.getSetting(userId, 'cost_governor') || {};
    const s = typeof stored === 'object' ? stored : {};
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    return {
      enabled: s.enabled !== false,
      perRequestUsd: num(s.per_request_usd),
      perDayUsd: num(s.per_day_usd),
      perMonthUsd: num(s.per_month_usd),
      action: s.action === 'block' ? 'block' : 'downgrade',
    };
  }

  function daySpend(userId) {
    const day = new Date().toISOString().slice(0, 10);
    const cached = dayCache.get(userId);
    if (cached && cached.day === day) return cached;
    const spend = repos.intelligence.usageDaySpend(userId, day);
    const value = { day, ...spend };
    dayCache.set(userId, value);
    return value;
  }

  
  function authorize({ userId, modelRow, purpose, promptTokens = 0, completionTokens = 0, repos_context = null }) {
    try {
      const cfg = settingsFor(userId);
      if (!cfg.enabled) return { allowed: true };
      const providerKind = modelRow?._providerKind || null;
      const { usd } = estimateCost(modelRow, { promptTokens, completionTokens }, providerKind);
      const est = { usd, promptTokens, completionTokens, purpose };

      if (cfg.perRequestUsd != null && usd > cfg.perRequestUsd) {
        return budgetExceeded(userId, cfg, est, `request estimate $${usd.toFixed(4)} exceeds the $${cfg.perRequestUsd} per-request budget`);
      }

      const day = daySpend(userId);
      if (cfg.perDayUsd != null && day.cost + usd > cfg.perDayUsd) {
        return budgetExceeded(userId, cfg, est, `today's spend ($${day.cost.toFixed(2)}) would exceed the $${cfg.perDayUsd} daily budget`);
      }

      if (cfg.perMonthUsd != null) {
        const month = repos.intelligence.usageMonthSpend(userId, day.day.slice(0, 7));
        if (month.cost + usd > cfg.perMonthUsd) {
          return budgetExceeded(userId, cfg, est, `this month's spend ($${month.cost.toFixed(2)}) would exceed the $${cfg.perMonthUsd} monthly budget`);
        }
      }
      return { allowed: true, estimate: est };
    } catch (err) {
      log.warn(`cost authorize failed (allowing): ${err.message}`);
      return { allowed: true };
    }
  }

  function budgetExceeded(userId, cfg, est, why) {
    if (cfg.action === 'block') {
      return { allowed: false, reason: why, estimate: est };
    }
    
    return { allowed: true, downgrade: true, reason: why, estimate: est };
  }

  
  function record({ userId, sessionId = null, runId = null, turnId = null, modelRow, purpose = 'turn', promptTokens = 0, completionTokens = 0, providerKind = null }) {
    try {
      if (!modelRow || (!promptTokens && !completionTokens)) return;
      const { usd } = estimateCost(modelRow, { promptTokens, completionTokens }, providerKind);
      repos.intelligence.recordUsage({
        id: randomId('usg'),
        userId,
        sessionId,
        runId,
        turnId,
        modelRowId: modelRow.id,
        modelId: modelRow.modelId,
        providerId: modelRow.providerId || null,
        purpose,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        estCostUsd: usd,
      });
      const day = new Date().toISOString().slice(0, 10);
      const cached = dayCache.get(userId);
      if (cached && cached.day === day) {
        cached.cost += usd;
        cached.requests += 1;
      }
    } catch (err) {
      log.debug(`usage ledger write failed: ${err.message}`);
    }
  }

  function turnCost(turnId) {
    try {
      return repos.intelligence.turnCost(turnId);
    } catch {
      return { cost: 0, promptTokens: 0, completionTokens: 0 };
    }
  }

  
  function summary(userId) {
    const cfg = settingsFor(userId);
    let data = { today: { cost: 0, requests: 0 }, month: { cost: 0, requests: 0 }, byDay: [], byModel: [] };
    try {
      data = repos.intelligence.usageSummary(userId);
    } catch (err) {
      log.warn(`usage summary failed: ${err.message}`);
    }
    return { budgets: cfg, ...data };
  }

  return { authorize, record, turnCost, summary, priceFor, estimateCost, settingsFor, daySpend };
}
