


















import { logger } from '../core/logger.js';
import { localFsAvailable } from '../tools/local-bridge.js';
import { builtinSkills } from './skills.js';
import { builtinPlugins } from './builtin-plugins.js';
import { createSkillService } from './skills.service.js';
import { createPluginService } from './plugins.js';
import { planTurn } from './orchestrator.js';

const log = logger('harness');


export const HARNESS_DEFAULTS = {
  auto_orchestrate: true, 
  auto_skills: true, 
  plugin_tools: true, 
  connector_tools: true, 
  max_matched_skills: 3,
  disabled_tools: [], 
  disabled_skills: [], 
};

export function harnessSettings(repos, userId) {
  const stored = repos.users.getSetting(userId, 'harness') || {};
  const merged = { ...HARNESS_DEFAULTS, ...(typeof stored === 'object' ? stored : {}) };
  const stringList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []);
  merged.disabled_tools = stringList(merged.disabled_tools);
  merged.disabled_skills = stringList(merged.disabled_skills);
  return merged;
}

export function createHarness({ repos, connectors, audit, policy }) {
  const skills = createSkillService({ repos, audit });
  const plugins = createPluginService({ repos, audit });

  
  async function toolCatalog(userId, { settings = null, allowedTools = null, mode = null } = {}) {
    const cfg = settings || harnessSettings(repos, userId);
    const catalog = new Map();
    const origin = new Map();

    
    
    
    const registry = await import('../tools/registry.js');
    const packOf = new Map();
    for (const pack of builtinPlugins()) {
      for (const tool of pack.tools) if (!packOf.has(tool.name)) packOf.set(tool.name, pack.slug);
    }
    for (const [name, tool] of registry.defaultCatalog()) {
      catalog.set(name, tool);
      origin.set(name, {
        kind: 'core',
        label: packOf.has(name) ? builtinPlugins().find((p) => p.slug === packOf.get(name))?.name || 'Built-in' : 'Built-in',
        packSlug: packOf.get(name) || null,
      });
    }

    
    if (cfg.connector_tools && connectors?.catalog) {
      try {
        for (const [name, tool] of await connectors.catalog(userId)) {
          if (catalog.has(name)) continue;
          catalog.set(name, tool);
          origin.set(name, { kind: tool.connectorId ? 'connector' : 'connector', label: 'Connection' });
        }
      } catch (err) {
        log.warn(`connector catalog unavailable for ${userId}: ${err.message}`);
      }
    }

    
    if (cfg.plugin_tools) {
      try {
        for (const [name, tool] of await plugins.toolCatalog(userId)) {
          if (catalog.has(name)) continue;
          catalog.set(name, tool);
          origin.set(name, { kind: 'plugin', label: 'Plugin', pluginSlug: tool.pluginSlug || null });
        }
      } catch (err) {
        log.warn(`plugin catalog unavailable for ${userId}: ${err.message}`);
      }
    }

    
    
    
    
    
    const disabled = new Set(cfg.disabled_tools || []);
    if (allowedTools?.length) {
      for (const name of [...catalog.keys()]) if (!allowedTools.includes(name)) catalog.delete(name);
    }
    for (const name of disabled) catalog.delete(name);
    if (!localFsAvailable(userId)) {
      for (const name of [...catalog.keys()]) if (name.startsWith('local_')) catalog.delete(name);
    }
    const denied = new Set();
    if (policy) {
      const activeMode = mode || repos.users.getSetting(userId, 'permission_mode') || 'ask';
      for (const [name, tool] of [...catalog.entries()]) {
        if (!tool.sensitive) continue;
        try {
          const verdict = await policy.evaluate({ userId, tool, args: null, mode: activeMode });
          if (verdict.decision === 'deny') denied.add(name);
        } catch {  }
      }
    }

    return { catalog, origin, denied: [...denied] };
  }

  
  function skillCatalog(userId) {
    const settings = harnessSettings(repos, userId);
    const disabled = new Set(settings.disabled_skills || []);
    const builtin = builtinSkills().map((s) => ({ ...s, source: 'builtin' }));
    const fromPlugins = plugins.pluginSkills(userId);
    const user = skills.all(userId).filter((s) => s.source === 'user');
    const seen = new Set();
    const out = [];
    for (const s of [...builtin, ...fromPlugins, ...user]) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      out.push(disabled.has(s.slug) ? { ...s, enabled: false } : s);
    }
    return out;
  }

  
  function toolSchemas(catalog, origin, denied = []) {
    const hidden = new Set(denied);
    return [...catalog.entries()]
      .filter(([name]) => !hidden.has(name))
      .map(([name, tool]) => ({
        name,
        displayName: tool.displayName || name,
        description: tool.description || '',
        sensitive: !!tool.sensitive,
        parameters: tool.parameters || { type: 'object', properties: {} },
        origin: origin.get(name) || { kind: 'core', label: 'Built-in' },
      }));
  }

  
  async function prepareTurn({ userId, query, projectId = null, allowedTools = null }) {
    const settings = harnessSettings(repos, userId);
    const { catalog, origin, denied } = await toolCatalog(userId, { settings, allowedTools });
    const schemas = toolSchemas(catalog, origin, denied);
    const allSkills = skillCatalog(userId);

    const plan = planTurn({
      query,
      schemas,
      skills: allSkills,
      settings,
      guidance: plugins.pluginGuidance(userId),
    });

    return { catalog, origin, schemas, skills: allSkills, plan, settings };
  }

  
  async function snapshot(userId) {
    const settings = harnessSettings(repos, userId);
    const { catalog, origin, denied } = await toolCatalog(userId, { settings });
    const schemas = toolSchemas(catalog, origin, denied);
    const allSkills = skillCatalog(userId);
    const pluginList = plugins.list(userId);

    let connectorRows = [];
    try {
      connectorRows = (await connectors.list(userId)) || [];
    } catch (err) {
      log.warn(`connector list unavailable: ${err.message}`);
    }

    const byOrigin = (kind) => schemas.filter((s) => s.origin.kind === kind);
    return {
      settings,
      counts: {
        tools: schemas.length,
        core: byOrigin('core').length,
        connectors: byOrigin('connector').length,
        pluginTools: byOrigin('plugin').length,
        skills: allSkills.length,
        builtinSkills: allSkills.filter((s) => s.source === 'builtin').length,
        userSkills: allSkills.filter((s) => s.source === 'user').length,
        plugins: pluginList.length,
        builtinPlugins: pluginList.filter((p) => p.builtin).length,
        mcpServers: connectorRows.filter((c) => c.kind === 'mcp').length,
        httpPlugins: connectorRows.filter((c) => c.kind === 'http').length,
      },
      tools: schemas.map((s) => ({ ...s, enabled: !(settings.disabled_tools || []).includes(s.name) })),
      skills: allSkills,
      plugins: pluginList,
      packs: builtinPlugins().map((p) => ({
        slug: p.slug,
        name: p.name,
        version: p.version,
        description: p.description,
        tools: p.tools.map((t) => t.name),
        skills: (p.skills || []).map((s) => s.slug),
      })),
    };
  }

  return {
    skills,
    plugins,
    toolCatalog,
    skillCatalog,
    toolSchemas,
    prepareTurn,
    snapshot,
    settings: (userId) => harnessSettings(repos, userId),
    HARNESS_DEFAULTS,
  };
}

export { builtinPlugins, builtinSkills };