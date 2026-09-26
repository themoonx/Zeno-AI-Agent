



















import { logger } from '../core/logger.js';

const log = logger('model-router');

export const TIERS = ['local', 'fast', 'balanced', 'reasoning', 'premium'];

const TIER_PATTERNS = [
  ['fast', /(mini|flash|haiku|nano|small|lite|instant|turbo-lite|8b|7b|3b|1b|air|fast)/i],
  ['reasoning', /(^|[-_.])(o1|o3|o4)([-_.]|$)|reasoning|thinking|r1|qwq|deepseek-reasoner|deep-research|magistral/i],
  ['premium', /(opus|ultra|gpt-5|gpt-4\.5|max|grok-4|o1-preview|premier|pro-max)/i],
];

function providerKindOf(repos, userId, modelRow) {
  const provider = repos.providers.getProvider(userId, modelRow.providerId);
  return provider?.kind || null;
}


export function classifyModelRow(modelRow, providerKind) {
  const explicit = modelRow?.params?.routing_tier;
  if (explicit && TIERS.includes(explicit)) return explicit;
  if (providerKind === 'ollama') return 'local';
  const id = [modelRow?.modelId, modelRow?.displayName].filter(Boolean).join(' ');
  for (const [tier, re] of TIER_PATTERNS) {
    if (re.test(id)) return tier;
  }
  if (Array.isArray(modelRow?.capabilities) && modelRow.capabilities.includes('reasoning')) return 'reasoning';
  return 'balanced';
}

export function createModelRouter({ repos, decision = null }) {
  
  function modelsByTier(userId) {
    const byTier = new Map(TIERS.map((t) => [t, []]));
    const models = repos.providers.listModels(userId) || [];
    for (const m of models) {
      const kind = providerKindOf(repos, userId, m);
      const tier = classifyModelRow(m, kind);
      byTier.get(tier).push({ ...m, _providerKind: kind, _providerStatus: (repos.providers.getProvider(userId, m.providerId) || {}).status || null });
    }
    for (const list of byTier.values()) {
      list.sort((a, b) => {
        const unhealthy = (x) => (x._providerStatus === 'error' ? 1 : 0);
        if (unhealthy(a) !== unhealthy(b)) return unhealthy(a) - unhealthy(b);
        return (b.contextWindow || 0) - (a.contextWindow || 0);
      });
    }
    return byTier;
  }

  
  function select(userId, tier, { excludeIds = [] } = {}) {
    const byTier = modelsByTier(userId);
    const start = TIERS.indexOf(tier);
    if (start < 0) return null;
    const order = [
      ...TIERS.slice(0, start + 1).reverse(), 
      ...TIERS.slice(start + 1), 
    ];
    for (const t of order) {
      const candidate = byTier.get(t).find((m) => !excludeIds.includes(m.id));
      if (candidate) return candidate;
    }
    return null;
  }

  
  function escalationModel(userId, modelRowId) {
    const current = repos.providers.getModel(userId, modelRowId);
    if (!current) return null;
    const kind = providerKindOf(repos, userId, current);
    const tier = classifyModelRow(current, kind);
    const idx = TIERS.indexOf(tier);
    if (idx < 0 || idx >= TIERS.length - 1) return null;
    return select(userId, TIERS[idx + 1], { excludeIds: [modelRowId] });
  }

  
  function routingConfig(userId) {
    const stored = repos.users.getSetting(userId, 'model_routing') || {};
    const s = typeof stored === 'object' ? stored : {};
    const mode = ['off', 'aux', 'full'].includes(s.mode) ? s.mode : 'aux';
    const tierOf = (v, def) => (TIERS.includes(v) ? v : def);
    return {
      mode,
      auxTiers: {
        planning: tierOf(s.planning_tier, 'fast'),
        compaction: tierOf(s.compaction_tier, 'fast'),
        wrapup: tierOf(s.wrapup_tier, 'balanced'),
        verification: tierOf(s.verification_tier, 'balanced'),
      },
    };
  }

  const AUX_PURPOSES = new Set(['planning', 'compaction', 'wrap-up', 'verification', 'research-planning']);

  
  function purposeModel({ userId, requested, purpose, decision = null }) {
    if (!requested) return requested;
    try {
      const cfg = routingConfig(userId);
      if (cfg.mode === 'off') return requested;
      const isAux = AUX_PURPOSES.has(purpose);
      const mainRouted = purpose === 'main' && cfg.mode === 'full' && decision?.executionMode === 'agent';
      if (!isAux && !mainRouted) return requested;

      let tier;
      if (mainRouted) {
        const bias = decision ? tierBiasSafe(userId, decision.taskType) : 0;
        tier = shiftTier(decision.modelTier, bias);
      } else {
        tier = cfg.auxTiers[purpose] || 'balanced';
      }
      const chosen = select(userId, tier, { excludeIds: [] });
      if (!chosen || chosen.id === requested) return requested;
      log.debug(`purpose ${purpose} routed to tier ${tier} (${chosen.modelId})`);
      return chosen.id;
    } catch (err) {
      log.warn(`purpose routing failed (${purpose}), using requested model: ${err.message}`);
      return requested;
    }
  }

  function tierBiasSafe(userId, taskType) {
    try {
      const stored = repos.users.getSetting(userId, 'model_routing') || {};
      if ((typeof stored === 'object' ? stored.learning : true) === false) return 0;
      return decision?.tierBias ? decision.tierBias(userId, taskType) : 0;
    } catch {
      return 0;
    }
  }

  function shiftTier(tier, steps) {
    const idx = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + steps));
    return TIERS[idx];
  }

  
  function tierMap(userId) {
    const byTier = modelsByTier(userId);
    const out = {};
    for (const [tier, rows] of byTier) for (const r of rows) out[r.id] = tier;
    return out;
  }

  return { TIERS, modelsByTier, select, escalationModel, purposeModel, routingConfig, classifyModelRow, tierMap };
}
