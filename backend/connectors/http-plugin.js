




import { errors } from '../core/errors.js';
import { requestViaPublicInternet } from './fetch.js';

const CALL_TIMEOUT_MS = 60_000;
const MAX_CHARS = 16_000;

export function makeHttpPluginTool(row, secret = null, transport = requestViaPublicInternet) {
  const name = row.toolName || `connector_${row.id.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  const parameters = row.schemaSpec && row.schemaSpec.type === 'object'
    ? row.schemaSpec
    : { type: 'object', properties: {}, additionalProperties: false };

  async function execute(args, { signal } = {}) {
    const res = await transport(row.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        ...(row.headers || {}),
      },
      body: JSON.stringify({ arguments: args ?? {} }),
      signal: signal || AbortSignal.timeout(CALL_TIMEOUT_MS),
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
      throw errors.upstream(`HTTP plugin returned ${res.status}`, { status: res.status, body: (parsed ?? text).toString().slice(0, 600) });
    }
    return {
      ok: true,
      status: res.status,
      contentType,
      body: parsed !== null ? parsed : text.slice(0, MAX_CHARS),
      truncated: text.length > MAX_CHARS,
    };
  }

  return {
    connectorId: row.id,
    tool: {
      name,
      displayName: row.name,
      description: row.toolDescription || `User HTTP plugin: ${row.name}`,
      sensitive: true,
      parameters,
      execute,
    },
  };
}

export async function discoverHttpPlugin(row, { signal, secret = null, transport = requestViaPublicInternet } = {}) {
  const res = await transport(row.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...(row.headers || {}),
    },
    body: JSON.stringify({ arguments: {} }),
    signal: signal || AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  await res.text().catch(() => '');
  if (!res.ok) {
    throw errors.upstream(`Endpoint returned ${res.status}`, { status: res.status });
  }
  const schema = row.schemaSpec && row.schemaSpec.type === 'object'
    ? row.schemaSpec
    : { type: 'object', properties: {}, additionalProperties: false };
  return {
    ok: true,
    protocol: 'http_plugin',
    tools: [
      {
        name: row.toolName || `connector_${row.id.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`,
        description: row.toolDescription || `User HTTP plugin: ${row.name}`,
        inputSchema: schema,
      },
    ],
  };
}
