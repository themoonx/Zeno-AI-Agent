// The Harness — Zeno's capability orchestration layer.
//
// Everything the agent can do is a *capability* with a single shape, whatever
// its origin:
//
//   Tools     — built-in registry, MCP servers, HTTP plugins, plugin packs
//   Skills    — instruction packs (on disk, user-authored, plugin-contributed)
//   Plugins   — capability bundles contributing tools + skills + guidance
//   MCP       — remote Model Context Protocol servers (a connector kind)
//   Memory    — persistent context, injected and searchable
//   Providers — any model endpoint (own keys / custom base URLs)
//
// The harness merges all of them per user, per turn, and decides what to offer
// the model. The model then chooses what to actually call — the harness
// orchestrates availability and gating, never the model's judgement.
//
// Extensibility contract: adding a capability means registering a descriptor —
// a file in skills/, a pack in builtin-plugins.js, a connector row, or a
// provider kind. No engine change is required.
import { logger } from '../core/logger.js';
import { localFsAvailable } from '../tools/local-bridge.js';
import { builtinSkills } from './skills.js';
import { builtinPlugins } from './builtin-plugins.js';
import { createSkillService } from './skills.service.js';
import { createPluginService } from './plugins.js';
import { planTurn } from './orchestrator.js';

const log = logger('harness');

// Defaults for harness behaviour; overridable per user via Settings → Harness.
export const HARNESS_DEFAULTS = {
  auto_orchestrate: true, // match skills + capabilities automatically per request
  auto_skills: true, // inject matched skill instructions into the turn
  plugin_tools: true, // offer tools contributed by plugin packs
  connector_tools: true, // offer tools from the user's MCP servers / HTTP plugins
  max_matched_skills: 3,
  disabled_tools: [], // capability off-switches, by tool name
  disabled_skills: [], // skill off-switches, by slug (built-ins are read-only on disk)
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

  /**
   * The full capability catalog for one user: every tool they can currently
   * call, from every origin. Precedence on name collision is
   * built-in registry → MCP/HTTP connectors → plugin packs, so a shipped tool
   * can never be shadowed by user config.
   *
   * Policy-denied tools stay IN the catalog (the executor must be able to deny
   * them with a real "blocked by policy" message if the model calls one
   * anyway) but are reported as `denied` so toolSchemas can hide them from the
   * model-visible schema.
   */
  async function toolCatalog(userId, { settings = null, allowedTools = null, mode = null } = {}) {
    const cfg = settings || harnessSettings(repos, userId);
    const catalog = new Map();
    const origin = new Map();

    // 1. Built-in registry (the core toolset). Tools that belong to a shipped
    //    capability pack are attributed to that pack, so the UI can show which
    //    capability bundle provides what.
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

    // 2. The user's MCP servers and HTTP plugins (a connector kind).
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

    // 3. Plugin packs (built-in packs + the user's installed plugins).
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

    // Explicit allow-list and per-user off-switches. Local-computer tools are
    // additionally availability-scoped: they only appear when a local agent is
    // paired+online for this user or the server-side bridge is enabled.
    // Policy-denied capabilities are REPORTED (not deleted): the schema hides
    // them from the model, while the executor still denies them by name.
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
        } catch { /* evaluation failure must not hide capabilities */ }
      }
    }

    return { catalog, origin, denied: [...denied] };
  }

  /**
   * Every skill the user can use: shipped skills, plugin-contributed skills,
   * and the user's own — merged with built-ins taking precedence by slug.
   * Built-in skills are read-only on disk, so disabling one is stored as a
   * per-user override in harness settings.
   */
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

  /** Tool descriptors the model may call this turn, annotated with origin.
   *  Policy-denied tools are hidden from this view (they remain in the catalog
   *  so the executor can deny them with the real policy message). */
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

  /**
   * Decide what this turn gets: matched skills, the tool catalog, and the
   * prompt block describing them. This is the orchestration step — it runs
   * before every model call, so the model always sees current capabilities.
   */
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

  /** Grouped capability view for the Settings UI. */
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