



import { randomId, encryptSecret, decryptSecret } from '../core/crypto.js';
import { errors } from '../core/errors.js';
import { validate } from '../core/validate.js';
import { assertPublicHttpUrl } from './guard.js';
import { logger } from '../core/logger.js';
import { makeHttpPluginTool, discoverHttpPlugin } from './http-plugin.js';
import { makeMcpTools, listMcpTools } from './mcp.js';

const log = logger('connectors');

const MAX_CONNECTORS = 50;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,63}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;
const DISCOVER_TIMEOUT_MS = 20_000;

function sanitizeHeaders(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 16)) {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(k)) continue;
    if (['authorization', 'cookie', 'proxy-authorization', 'host'].includes(k.toLowerCase())) continue;
    out[k] = String(v).slice(0, 512);
  }
  return out;
}

export function sanitizeSchemaSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  try {
    const json = JSON.stringify(spec);
    if (json.length > 8000) return null;
    const parsed = JSON.parse(json);
    if (parsed.type !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function publicConnector(c) {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    endpoint: c.endpoint,
    headers: c.headers || {},
    schemaSpec: c.schemaSpec || null,
    enabled: !!c.enabled,
    toolName: c.toolName || null,
    toolDescription: c.toolDescription || null,
    status: c.status,
    statusDetail: c.statusDetail || null,
    hasSecret: !!c.hasSecret,
    secretMask: c.hasSecret ? '••••••••' : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export function createConnectorService({ repos, audit, transport, validateEndpoint = assertPublicHttpUrl }) {
  async function list(userId) {
    return repos.connectors.listConnectors(userId).map(publicConnector);
  }

  async function get(userId, id) {
    const row = repos.connectors.getConnector(userId, id);
    if (!row) throw errors.notFound('Connector');
    return publicConnector(row);
  }

  async function create(userId, body) {
    const input = validate(body, {
      kind: { type: 'string', required: true, enum: ['http', 'mcp'] },
      name: { type: 'string', required: true, min: 1, max: 64 },
      endpoint: { type: 'string', required: true, min: 1, max: 2048 },
      secret: { type: 'string', max: 2048 },
      headers: { type: 'object' },
      schemaSpec: { type: 'object' },
      toolName: { type: 'string', max: 64 },
      toolDescription: { type: 'string', max: 600 },
      enabled: { type: 'boolean', default: true },
    });
    if (!NAME_RE.test(input.name)) throw errors.badRequest('Name has invalid characters');
    await validateEndpoint(input.endpoint);
    if (input.kind === 'http') {
      if (!input.toolName) throw errors.badRequest('toolName is required for HTTP plugins');
      if (!TOOL_NAME_RE.test(input.toolName)) throw errors.badRequest('toolName must be lowercase snake_case (3-64 chars)');
      if (!input.schemaSpec) throw errors.badRequest('schemaSpec is required for HTTP plugins');
      if (!sanitizeSchemaSpec(input.schemaSpec)) throw errors.badRequest('schemaSpec must be a JSON Schema object with type=object (max 8KB)');
    }
    if (repos.connectors.countConnectors(userId) >= MAX_CONNECTORS) throw errors.conflict('Connector limit reached');
    const id = randomId('conn');
    repos.connectors.createConnector({
      id,
      userId,
      kind: input.kind,
      name: input.name,
      endpoint: input.endpoint,
      secretEnc: input.secret ? encryptSecret(input.secret) : null,
      headers: sanitizeHeaders(input.headers),
      schemaSpec: input.kind === 'http' ? sanitizeSchemaSpec(input.schemaSpec) : null,
      toolName: input.kind === 'http' ? input.toolName : null,
      toolDescription: input.toolDescription || null,
      enabled: input.enabled,
    });
    audit({ userId, action: 'connector.create', target: id, meta: { kind: input.kind, name: input.name } });
    return get(userId, id);
  }

  async function update(userId, id, body) {
    const row = repos.connectors.getConnector(userId, id);
    if (!row) throw errors.notFound('Connector');
    const input = validate(body, {
      name: { type: 'string', min: 1, max: 64 },
      endpoint: { type: 'string', min: 1, max: 2048 },
      secret: { type: 'string', max: 2048 },
      headers: { type: 'object' },
      schemaSpec: { type: 'object' },
      toolName: { type: 'string', max: 64 },
      toolDescription: { type: 'string', max: 600 },
      enabled: { type: 'boolean' },
    });
    const fields = {};
    if (input.name !== undefined) {
      if (!NAME_RE.test(input.name)) throw errors.badRequest('Name has invalid characters');
      fields.name = input.name;
    }
    if (input.endpoint !== undefined) {
      await validateEndpoint(input.endpoint);
      fields.endpoint = input.endpoint;
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
    if (input.headers !== undefined) fields.headers = sanitizeHeaders(input.headers);
    if (input.schemaSpec !== undefined) {
      const spec = sanitizeSchemaSpec(input.schemaSpec);
      if (row.kind === 'http' && !spec) throw errors.badRequest('schemaSpec must be a JSON Schema object with type=object (max 8KB)');
      fields.schema_spec = spec;
    }
    if (input.toolName !== undefined && row.kind === 'http') {
      if (!TOOL_NAME_RE.test(input.toolName)) throw errors.badRequest('toolName must be lowercase snake_case (3-64 chars)');
      fields.tool_name = input.toolName;
    }
    if (input.toolDescription !== undefined) fields.tool_description = String(input.toolDescription).slice(0, 600);
    if (input.enabled !== undefined) fields.enabled = input.enabled ? 1 : 0;
    repos.connectors.updateConnector(userId, id, fields);
    audit({ userId, action: 'connector.update', target: id, meta: { keys: Object.keys(fields) } });
    return get(userId, id);
  }

  async function remove(userId, id) {
    const row = repos.connectors.getConnector(userId, id);
    if (!row) throw errors.notFound('Connector');
    repos.connectors.deleteConnector(userId, id);
    invalidateMcpCache(id);
    audit({ userId, action: 'connector.delete', target: id, meta: { name: row.name } });
    return { ok: true };
  }

  async function setEnabled(userId, id, enabled) {
    const row = repos.connectors.getConnector(userId, id);
    if (!row) throw errors.notFound('Connector');
    repos.connectors.updateConnector(userId, id, { enabled: enabled ? 1 : 0 });
    invalidateMcpCache(id);
    audit({ userId, action: enabled ? 'connector.enable' : 'connector.disable', target: id });
    return get(userId, id);
  }

  async function discover(userId, id) {
    const row = repos.connectors.getConnector(userId, id);
    if (!row) throw errors.notFound('Connector');
    const secret = secretFor(row);
    try {
      const probe = row.kind === 'mcp'
        ? await listMcpTools(row, { signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS), secret, transport })
        : await discoverHttpPlugin(row, { signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS), secret, transport });
      repos.connectors.updateConnector(userId, id, { status: 'connected', status_detail: null, status_checked_at: Date.now() });
      return probe;
    } catch (err) {
      const detail = String(err.message || err).slice(0, 300);
      repos.connectors.updateConnector(userId, id, { status: 'error', status_detail: detail, status_checked_at: Date.now() });
      throw errors.upstream(`Connector discovery failed: ${detail}`);
    }
  }

  function secretFor(row) {
    if (!row.hasSecret) return null;
    const raw = repos.connectors.getConnectorRaw(row.id)?.secret_enc ?? null;
    return raw ? decryptSecret(raw) : null;
  }

  
  
  
  const mcpCache = new Map(); 
  const MCP_CACHE_TTL = 60_000;

  function invalidateMcpCache(connectorId) {
    mcpCache.delete(connectorId);
  }

  async function mcpToolsFor(row, secret) {
    const key = String(row.updated_at || '');
    const hit = mcpCache.get(row.id);
    if (hit && hit.key === key && hit.expires > Date.now()) return hit.tools;
    const mcp = makeMcpTools(row, secret, transport);
    let tools = [];
    if (mcp.kind === 'mcp_dynamic') {
      tools = await mcp.resolve({ signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS) }).catch(() => []);
    }
    mcpCache.set(row.id, { key, expires: Date.now() + MCP_CACHE_TTL, tools });
    return tools;
  }

  async function catalog(userId) {
    const tools = new Map();
    for (const row of repos.connectors.listEnabled(userId)) {
      const secret = secretFor(row);
      try {
        if (row.kind === 'http') {
          const { tool } = makeHttpPluginTool(row, secret, transport);
          tools.set(tool.name, tool);
        } else {
          for (const tool of await mcpToolsFor(row, secret)) {
            if (!tools.has(tool.name)) tools.set(tool.name, tool);
          }
        }
      } catch (err) {
        log.warn(`connector ${row.id} skipped from catalog: ${err.message}`);
      }
    }
    return tools;
  }

  return { list, get, create, update, remove, setEnabled, discover, catalog, publicConnector, invalidateMcpCache };
}
