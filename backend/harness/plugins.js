









import { randomId, encryptSecret, decryptSecret } from '../core/crypto.js';
import { errors } from '../core/errors.js';
import { validate } from '../core/validate.js';
import { logger } from '../core/logger.js';
import { slugify } from './skills.js';
import { builtinPlugins } from './builtin-plugins.js';
import { assertPublicHttpUrl } from '../connectors/guard.js';
import { requestViaPublicInternet } from '../connectors/fetch.js';

const log = logger('harness:plugins');

const MAX_USER_PLUGINS = 50;
const MAX_TOOLS_PER_PLUGIN = 24;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;
const CALL_TIMEOUT_MS = 60_000;
const MAX_CHARS = 16_000;
const MAX_MANIFEST_BYTES = 32_000;


function toolFromSpec(spec, plugin, ctx) {
  const name = spec.name;
  return {
    name,
    displayName: spec.displayName || `${plugin.name} · ${name}`,
    description: spec.description || `Tool ${name} from plugin ${plugin.name}`,
    sensitive: true,
    pluginId: plugin.id,
    pluginSlug: plugin.slug,
    parameters:
      spec.parameters && spec.parameters.type === 'object'
        ? spec.parameters
        : { type: 'object', properties: {}, additionalProperties: false },
    async execute(args, runCtx = {}) {
      const res = await (ctx.transport || requestViaPublicInternet)(spec.endpoint, {
        method: spec.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(ctx.secret ? { Authorization: `Bearer ${ctx.secret}` } : {}),
          ...(spec.headers || {}),
        },
        body: JSON.stringify({ arguments: args ?? {} }),
        signal: runCtx.signal || AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const text = await res.text();
      let parsed = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        try {
          parsed = JSON.parse(text);
        } catch {
          
        }
      }
      if (!res.ok) {
        throw errors.upstream(`Plugin "${plugin.name}" tool ${name} returned ${res.status}`, {
          status: res.status,
          body: String(parsed ?? text).slice(0, 600),
        });
      }
      return {
        ok: true,
        plugin: plugin.slug,
        tool: name,
        status: res.status,
        body: parsed !== null ? parsed : text.slice(0, MAX_CHARS),
        truncated: text.length > MAX_CHARS,
      };
    },
  };
}


export function sanitizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const json = JSON.stringify(raw);
  if (json.length > MAX_MANIFEST_BYTES) return null;
  const toolSpecs = Array.isArray(raw.tools) ? raw.tools.slice(0, MAX_TOOLS_PER_PLUGIN) : [];
  const tools = [];
  for (const t of toolSpecs) {
    if (!t || typeof t !== 'object') continue;
    if (!TOOL_NAME_RE.test(String(t.name || ''))) return null;
    if (typeof t.endpoint !== 'string' || !t.endpoint) return null;
    if (t.method && !['GET', 'POST', 'PUT', 'PATCH'].includes(String(t.method).toUpperCase())) return null;
    const parameters = t.parameters && typeof t.parameters === 'object' && t.parameters.type === 'object' ? t.parameters : { type: 'object', properties: {} };
    if (JSON.stringify(parameters).length > 8000) return null;
    const headers = {};
    for (const [k, v] of Object.entries(t.headers || {}).slice(0, 16)) {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(k)) continue;
      if (['authorization', 'cookie', 'proxy-authorization', 'host'].includes(k.toLowerCase())) continue;
      headers[k] = String(v).slice(0, 512);
    }
    tools.push({
      name: String(t.name),
      displayName: t.displayName ? String(t.displayName).slice(0, 120) : null,
      description: t.description ? String(t.description).slice(0, 600) : null,
      endpoint: String(t.endpoint).slice(0, 2048),
      method: (String(t.method || 'POST').toUpperCase()),
      headers,
      parameters,
    });
  }
  if (!tools.length) return null;
  return {
    tools,
    skills: Array.isArray(raw.skills) ? raw.skills.slice(0, 8).filter((s) => s && typeof s === 'object') : [],
    guidance: typeof raw.guidance === 'string' ? raw.guidance.slice(0, 4000) : null,
  };
}

function publicPlugin(p) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    version: p.version || null,
    description: p.description || '',
    enabled: !!p.enabled,
    source: p.source || 'user',
    status: p.status || 'unverified',
    statusDetail: p.statusDetail || null,
    builtin: (p.source || 'user') === 'builtin',
    tools: (p.toolNames || []).map((n) => ({ name: n.name, description: n.description, sensitive: true })),
    skills: (p.skillSlugs || []).map(String),
    guidance: p.guidance || null,
    manifest: p.manifest || null,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

export function createPluginService({ repos, audit, transport = requestViaPublicInternet, validateEndpoint = assertPublicHttpUrl }) {
  function builtinRows() {
    return builtinPlugins().map((p) => ({
      id: `builtin:${p.slug}`,
      slug: p.slug,
      name: p.name,
      version: p.version,
      description: p.description,
      enabled: true,
      source: 'builtin',
      status: 'builtin',
      guidance: p.guidance || null,
      manifest: null,
      toolNames: p.tools.map((t) => ({ name: t.name, description: t.description })),
      skillSlugs: (p.skills || []).map((s) => s.slug),
      createdAt: null,
      updatedAt: null,
    }));
  }

  function userRows(userId) {
    return repos.plugins.listPlugins(userId).map((row) => {
      const manifest = row.manifest || { tools: [] };
      return {
        ...row,
        guidance: manifest.guidance || null,
        toolNames: (manifest.tools || []).map((t) => ({ name: t.name, description: t.description })),
        skillSlugs: (manifest.skills || []).map((s) => s.slug).filter(Boolean),
      };
    });
  }

  
  function list(userId) {
    return [...builtinRows(), ...userRows(userId)].map(publicPlugin);
  }

  function get(userId, id) {
    const row = [...builtinRows(), ...userRows(userId)].find((p) => p.id === id);
    if (!row) throw errors.notFound('Plugin');
    return publicPlugin(row);
  }

  
  function pluginSkills(userId) {
    const out = [];
    const rows = [...builtinPlugins(), ...userRows(userId).filter((r) => r.enabled)];
    for (const p of rows) {
      const isBuiltin = !('userId' in p);
      if (!isBuiltin && !p.enabled) continue;
      if (isBuiltin && p.source !== 'builtin') continue;
      for (const s of p.skills || []) {
        out.push({
          id: `plugin:${p.slug}:${s.slug}`,
          slug: s.slug,
          name: s.name,
          description: s.description || '',
          instructions: s.instructions || '',
          triggers: s.triggers || [],
          tools: s.tools || [],
          enabled: true,
          source: 'plugin',
          pluginSlug: p.slug,
        });
      }
    }
    return out;
  }

  
  function pluginGuidance(userId) {
    const parts = [];
    for (const p of builtinPlugins()) {
      if (p.guidance) parts.push(`[${p.name}] ${p.guidance}`);
    }
    for (const row of userRows(userId)) {
      if (!row.enabled) continue;
      if (row.guidance) parts.push(`[${row.name}] ${row.guidance}`);
    }
    return parts.join('\n');
  }

  
  async function toolCatalog(userId) {
    const tools = new Map();

    
    for (const p of builtinPlugins()) {
      for (const tool of p.tools) {
        tools.set(tool.name, { ...tool, pluginSlug: p.slug });
      }
    }

    
    for (const row of repos.plugins.listEnabled(userId)) {
      const manifest = row.manifest;
      if (!manifest?.tools?.length) continue;
      const raw = repos.plugins.getPlugin(userId, row.id);
      const secretEnc = repos.plugins.getPluginRaw ? repos.plugins.getPluginRaw(row.id)?.secret_enc : null;
      const secret = secretEnc ? decryptSecret(secretEnc) : null;
      for (const spec of manifest.tools) {
        if (tools.has(spec.name)) continue;
        try {
          tools.set(spec.name, toolFromSpec(spec, { id: row.id, slug: row.slug, name: row.name }, { secret, transport }));
        } catch (err) {
          log.warn(`plugin ${row.slug} tool ${spec.name} skipped: ${err.message}`);
        }
      }
    }
    return tools;
  }

  async function create(userId, body) {
    const input = validate(body, {
      name: { type: 'string', required: true, min: 1, max: 64 },
      version: { type: 'string', max: 32 },
      description: { type: 'string', max: 600 },
      secret: { type: 'string', max: 2048 },
      manifest: { type: 'object', required: true },
      enabled: { type: 'boolean', default: true },
    });
    const manifest = sanitizeManifest(input.manifest);
    if (!manifest) throw errors.badRequest('Invalid plugin manifest: needs 1-24 tools with snake_case names, endpoints, and object JSON Schemas');
    for (const t of manifest.tools) await validateEndpoint(t.endpoint);
    if (repos.plugins.countPlugins(userId) >= MAX_USER_PLUGINS) throw errors.conflict('Plugin limit reached');
    const slug = slugify(input.name);
    if (!slug) throw errors.badRequest('Plugin name must contain letters or digits');
    if (repos.plugins.getBySlug(userId, slug)) throw errors.conflict(`A plugin named "${slug}" already exists`);
    const id = randomId('plg');
    repos.plugins.createPlugin({
      id,
      userId,
      slug,
      name: input.name,
      version: input.version || null,
      description: input.description || null,
      manifest,
      enabled: input.enabled,
    });
    if (input.secret) repos.plugins.updatePlugin(userId, id, { secret_enc: encryptSecret(input.secret), has_secret: 1 });
    audit({ userId, action: 'plugin.create', target: id, meta: { slug, tools: manifest.tools.length } });
    return get(userId, id);
  }

  async function update(userId, id, body) {
    const existing = repos.plugins.getPlugin(userId, id);
    if (!existing) throw errors.notFound('Plugin');
    const input = validate(body, {
      name: { type: 'string', min: 1, max: 64 },
      version: { type: 'string', max: 32 },
      description: { type: 'string', max: 600 },
      secret: { type: 'string', max: 2048 },
      manifest: { type: 'object' },
      enabled: { type: 'boolean' },
    });
    const fields = {};
    if (input.name !== undefined) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,63}$/.test(input.name)) throw errors.badRequest('Name has invalid characters');
      fields.name = input.name;
    }
    if (input.version !== undefined) fields.version = input.version;
    if (input.description !== undefined) fields.description = input.description;
    if (input.manifest !== undefined) {
      const manifest = sanitizeManifest(input.manifest);
      if (!manifest) throw errors.badRequest('Invalid plugin manifest');
      for (const t of manifest.tools) await validateEndpoint(t.endpoint);
      fields.manifest = manifest;
    }
    if (input.secret !== undefined) {
      if (input.secret === '') {
        fields.secret_enc = null;
        fields.has_secret = 0;
      } else {
        fields.secret_enc = encryptSecret(input.secret);
        fields.has_secret = 1;
      }
    }
    if (input.enabled !== undefined) fields.enabled = input.enabled ? 1 : 0;
    repos.plugins.updatePlugin(userId, id, fields);
    audit({ userId, action: 'plugin.update', target: id, meta: { keys: Object.keys(fields) } });
    return get(userId, id);
  }

  function setEnabled(userId, id, enabled) {
    const existing = repos.plugins.getPlugin(userId, id);
    if (!existing) throw errors.notFound('Plugin');
    repos.plugins.updatePlugin(userId, id, { enabled: enabled ? 1 : 0 });
    audit({ userId, action: enabled ? 'plugin.enable' : 'plugin.disable', target: id });
    return get(userId, id);
  }

  function remove(userId, id) {
    const existing = repos.plugins.getPlugin(userId, id);
    if (!existing) throw errors.notFound('Plugin');
    repos.plugins.deletePlugin(userId, id);
    audit({ userId, action: 'plugin.delete', target: id, meta: { slug: existing.slug } });
    return { ok: true };
  }

  async function test(userId, id) {
    const row = repos.plugins.getPlugin(userId, id);
    if (!row) throw errors.notFound('Plugin');
    const manifest = row.manifest;
    if (!manifest?.tools?.length) return { ok: true, tools: 0, note: 'Plugin declares no tools' };
    const results = [];
    for (const spec of manifest.tools) {
      try {
        await validateEndpoint(spec.endpoint);
        results.push({ name: spec.name, ok: true });
      } catch (err) {
        results.push({ name: spec.name, ok: false, error: err.message });
      }
    }
    const failed = results.filter((r) => !r.ok);
    repos.plugins.updatePlugin(userId, id, {
      status: failed.length ? 'error' : 'connected',
      status_detail: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join('; ').slice(0, 300) : null,
    });
    if (failed.length) throw errors.upstream(`Plugin endpoints unreachable: ${failed.map((f) => f.name).join(', ')}`);
    return { ok: true, tools: results.length, results };
  }

  return { list, get, create, update, remove, setEnabled, test, toolCatalog, pluginSkills, pluginGuidance };
}