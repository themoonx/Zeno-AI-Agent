




import { errors } from '../core/errors.js';
import { requestViaPublicInternet } from './fetch.js';

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'zeno-ai', version: '1.0.0' };
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CHARS = 24_000;
const MAX_SSE_EVENTS = 100;

export const supportedTransports = ['streamable_http'];
export const unsupportedTransports = ['stdio', 'sse_legacy', 'websocket'];

function jsonHeaders(sessionId) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  };
}

function extractSseData(text) {
  const events = [];
  for (const block of String(text).split(/\n\n/)) {
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (!dataLines.length) continue;
    try {
      events.push(JSON.parse(dataLines.join('\n')));
    } catch {
      
    }
    if (events.length >= MAX_SSE_EVENTS) break;
  }
  return events;
}

function pickResult(events) {
  for (const ev of events) {
    if (ev?.id !== undefined && !ev.error && (ev.result || ev.error)) return ev;
  }
  return events.find((ev) => ev.result || ev.error) || null;
}

async function postJson(row, secret, payload, sessionId, signal, transport = requestViaPublicInternet) {
  const res = await transport(row.endpoint, {
    method: 'POST',
    headers: {
      ...jsonHeaders(sessionId),
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...(row.headers || {}),
    },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw errors.upstream(`MCP server returned ${res.status}`, { status: res.status, body: text.slice(0, 400) });
  }
  const sessionIdOut = res.headers.get('mcp-session-id') || sessionId || null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return { events: extractSseData(text), sessionId: sessionIdOut };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw errors.upstream('MCP server returned a non-JSON, non-SSE body');
  }
  return { events: [parsed], sessionId: sessionIdOut };
}

export async function listMcpTools(row, { signal, secret = null, transport = requestViaPublicInternet } = {}) {
  const initId = 1;
  const init = await postJson(
    row,
    secret,
    { jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
    null,
    signal,
    transport
  );
  const initMsg = pickResult(init.events);
  if (!initMsg?.result) {
    throw errors.upstream(`MCP initialize failed: ${JSON.stringify(initMsg?.error || initMsg).slice(0, 300)}`);
  }
  await postJson(row, secret, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, signal, transport).catch(() => {});

  const listed = await postJson(
    row,
    secret,
    { jsonrpc: '2.0', id: initId + 1, method: 'tools/list', params: {} },
    init.sessionId,
    signal,
    transport
  );
  const listMsg = pickResult(listed.events);
  if (!listMsg?.result) {
    throw errors.upstream(`MCP tools/list failed: ${JSON.stringify(listMsg?.error || listMsg).slice(0, 300)}`);
  }
  const tools = (listMsg.result.tools || []).slice(0, 64).map((t) => ({
    name: typeof t.name === 'string' ? t.name.slice(0, 64) : 'tool',
    description: typeof t.description === 'string' ? t.description.slice(0, 600) : '',
    inputSchema: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
  }));
  return {
    ok: true,
    protocol: 'mcp_streamable_http',
    transports: { supported: supportedTransports, unsupported: unsupportedTransports },
    session: init.sessionId || null,
    tools,
  };
}

async function callMcpTool(row, secret, toolName, args, { signal, transport = requestViaPublicInternet } = {}) {
  const initId = 1;
  const init = await postJson(
    row,
    secret,
    { jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
    null,
    signal,
    transport
  );
  const initMsg = pickResult(init.events);
  if (!initMsg?.result) {
    throw errors.upstream(`MCP initialize failed: ${JSON.stringify(initMsg?.error || initMsg).slice(0, 300)}`);
  }
  await postJson(row, secret, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, signal, transport).catch(() => {});
  const called = await postJson(
    row,
    secret,
    { jsonrpc: '2.0', id: initId + 2, method: 'tools/call', params: { name: toolName, arguments: args ?? {} } },
    init.sessionId,
    signal,
    transport
  );
  const callMsg = pickResult(called.events);
  if (!callMsg) throw errors.upstream('MCP tools/call produced no response');
  if (callMsg.error) {
    throw errors.upstream(`MCP tools/call failed: ${String(callMsg.error.message || JSON.stringify(callMsg.error)).slice(0, 300)}`);
  }
  const result = callMsg.result || {};
  const text = (result.content || [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .slice(0, MAX_CHARS);
  return {
    ok: !result.isError,
    content: text || null,
    structured: result.structuredContent ?? null,
    isError: !!result.isError,
  };
}

export function makeMcpTools(row, secret = null, transport = requestViaPublicInternet) {
  const prefix = (row.toolName || row.name)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+$/g, '')
    .slice(0, 32) || 'mcp';
  const schemaCache = { tools: null, at: 0 };

  async function ensureTools({ signal } = {}) {
    if (schemaCache.tools && Date.now() - schemaCache.at < 60_000) return schemaCache.tools;
    const { tools } = await listMcpTools(row, { signal, secret, transport });
    schemaCache.tools = tools;
    schemaCache.at = Date.now();
    return tools;
  }

  function descriptorFor(t) {
    return {
      name: `mcp_${prefix}_${t.name}`,
      displayName: `${row.name} · ${t.name}`,
      description: t.description || `Remote MCP tool ${t.name} via ${row.name}`,
      sensitive: true,
      connectorId: row.id,
      parameters: t.inputSchema,
      async execute(args, ctx) {
        return callMcpTool(row, secret, t.name, args, { signal: ctx?.signal, transport });
      },
    };
  }

  return {
    kind: 'mcp_dynamic',
    async resolve({ signal } = {}) {
      const tools = await ensureTools({ signal });
      return tools.map(descriptorFor);
    },
  };
}

export { callMcpTool };
