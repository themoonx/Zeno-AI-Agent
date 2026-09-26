

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ZENO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-conn-test-'));

const { initDatabase } = await import('../backend/database/index.js');
const { createConnectorService } = await import('../backend/connectors/service.js');

await initDatabase();
const { repos } = await import('../backend/database/index.js');

const TEST_USERS = ['user_secret', 'user_other', 'user_toggle', 'user_http', 'user_httperr', 'user_mcp', 'user_mcpcall', 'user_mcperr', 'user_ssrf', 'user_iso_a', 'user_iso_b', 'user_registry'];
for (const [i, u] of TEST_USERS.entries()) {
  repos.users.createUser({ id: u, email: `u${i}@test.dev`, displayName: u, passwordHash: 'x' });
}

const noopAudit = () => {};
const allowAllEndpoint = async () => {};



const recorded = [];
const mockBodyFor = (url, init = {}) => {
  let msg;
  try {
    msg = JSON.parse(init.body || '{}');
  } catch {
    msg = {};
  }
  if (msg.jsonrpc !== '2.0') {
    return JSON.stringify({ echoed: msg.arguments ?? {} });
  }
  if (msg.method === 'initialize') {
    if (String(url).includes('mcpbad')) {
      return JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'mock server refused' } });
    }
    return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'mock' } } });
  }
  if (msg.method === 'notifications/initialized') return '';
  if (msg.method === 'tools/list') {
    return `event: message\ndata: ${JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'mock_echo', description: 'Echo args', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] },
    })}\n\n`;
  }
  if (msg.method === 'tools/call') {
    return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `mock says: ${JSON.stringify(msg.params.arguments)}` }] } });
  }
  return '';
};

const recordingTransport = (options = {}) => async (url, init = {}) => {
  recorded.push({ url: String(url), ...init });
  const text = mockBodyFor(url, init);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: new Map(Object.entries({ ...contentTypeHeaders(url, init), ...(options.headers || {}) })),
    text: async () => (options.text !== undefined ? options.text : text),
  };
};

const mockTransport = recordingTransport();

function contentTypeHeaders(url, init) {
  let msg;
  try {
    msg = JSON.parse(init.body || '{}');
  } catch {
    msg = {};
  }
  return {
    'content-type': msg.method === 'tools/list' ? 'text/event-stream' : 'application/json',
    'mcp-session-id': 'sess-123',
    'mcp-protocol-version': '2025-06-18',
  };
}

function conn(id, over = {}) {
  return {
    id,
    userId: over.userId || 'user_x',
    kind: over.kind || 'http',
    name: over.name || 'Mock Plugin',
    endpoint: over.endpoint || 'https://connector.example.com/plugin',
    hasSecret: true,
    headers: over.headers || {},
    schemaSpec: over.schemaSpec ?? { type: 'object', properties: { text: { type: 'string' } } },
    toolName: over.toolName || 'mock_tool',
    toolDescription: over.toolDescription || null,
    enabled: true,
    status: 'connected',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

test('create persists encrypted secret; reads never leak it', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, validateEndpoint: allowAllEndpoint });
  const created = await connectors.create('user_secret', {
    kind: 'http',
    name: 'Echo Plugin',
    endpoint: 'https://api.example.com/plugin',
    secret: 'sk-conn-secret',
    headers: { 'X-Custom': 'yes', Authorization: 'spoof' },
    toolName: 'echo_plugin',
    toolDescription: 'Echo test',
    schemaSpec: { type: 'object', properties: { text: 'string' } },
  });
  const row = repos.connectors.getConnectorRaw(created.id);
  assert.ok(row.secret_enc);
  assert.ok(!row.secret_enc.includes('sk-conn-secret'));
  assert.notEqual(row.secret_enc, 'sk-conn-secret');
  const back = JSON.stringify(await connectors.get('user_secret', created.id));
  assert.ok(!back.includes('secret_enc'));
  assert.ok(!back.includes('sk-conn-secret'), 'plaintext secret leaked');
  assert.ok(!back.includes('spoof'), 'auth header leaked');
  assert.equal(created.hasSecret, true);
  assert.equal(created.secretMask, '••••••••');

  await assert.rejects(connectors.get('user_other', created.id), /not found/i);
  await connectors.remove('user_secret', created.id);
});

test('create/update reject private, metadata, and internal endpoints', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit });
  const bad = [
    'http://localhost:8080/x',
    'http://127.0.0.1:9/api',
    'http://10.1.2.3/api',
    'http://192.168.0.20/api',
    'http://172.16.5.5/api',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://mydb.internal/api',
    'https://127.0.0.1:3443/api',
    'https://192.168.1.1/admin',
  ];
  for (const url of bad) {
    await assert.rejects(
      connectors.create('user_ssrf', { kind: 'http', name: 'X', endpoint: url, toolName: 'x_tool', schemaSpec: { type: 'object' } }),
      { status: 400, code: 'blocked_url' },
      url
    );
    await assert.rejects(connectors.create('user_ssrf', { kind: 'mcp', name: 'M', endpoint: url }), { status: 400, code: 'blocked_url' }, url);
  }
  await assert.rejects(
    connectors.create('user_ssrf', { kind: 'http', name: 'Bad', endpoint: 'https://8.8.8.8/x', toolName: 'Bad Name!' }),
    /toolName/
  );
  await assert.rejects(
    connectors.create('user_ssrf', { kind: 'http', name: 'Bad', endpoint: 'https://8.8.8.8/x', toolName: 'ok_tool' }),
    /schemaSpec/
  );
});

test('enabled toggle + list reflect state; disabled connectors drop from catalog', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_toggle', {
    kind: 'http', name: 'Toggle', endpoint: 'https://t.example.com/x', toolName: 'toggle_tool', schemaSpec: { type: 'object' },
  });
  assert.equal((await connectors.setEnabled('user_toggle', c.id, false)).enabled, false);
  let cat = await connectors.catalog('user_toggle');
  assert.ok(!cat.has('toggle_tool'));
  assert.equal((await connectors.setEnabled('user_toggle', c.id, true)).enabled, true);
  cat = await connectors.catalog('user_toggle');
  assert.ok(cat.has('toggle_tool'));
  await connectors.remove('user_toggle', c.id);
});

test('http plugin tool: fixed endpoint POST {arguments} with bearer + custom headers', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_http', {
    kind: 'http', name: 'Echo', endpoint: 'https://api.example.com/plugin', secret: 'sk-conn-secret',
    headers: { 'X-Custom': 'yes' }, toolName: 'echo_plugin', toolDescription: 'Echo it',
    schemaSpec: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  });
  const tool = (await connectors.catalog('user_http')).get('echo_plugin');
  assert.ok(tool);
  assert.equal(tool.sensitive, true);
  assert.deepEqual(tool.parameters.required, ['text']);
  recorded.length = 0;
  const result = await tool.execute({ text: 'hello' }, { signal: AbortSignal.timeout(2000) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { echoed: { text: 'hello' } });
  const req = recorded[0];
  assert.equal(req.url, 'https://api.example.com/plugin');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Authorization'], 'Bearer sk-conn-secret');
  assert.equal(req.headers['X-Custom'], 'yes');
  assert.deepEqual(JSON.parse(req.body), { arguments: { text: 'hello' } });
  await connectors.remove('user_http', c.id);
});

test('http plugin error surfaces status + body through upstream error', async () => {
  const failTransport = async () => ({
    ok: false, status: 503,
    headers: new Map(), headersGet: () => null,
    text: async () => JSON.stringify({ error: 'boom' }),
  });
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: failTransport, validateEndpoint: allowAllEndpoint });
  const c = await createConn(connectors, 'user_httperr');
  const tool = (await connectors.catalog('user_httperr')).get('boom_tool');
  await assert.rejects(tool.execute({}, {}), /503|boom/i);
  await connectors.remove('user_httperr', c.id);
});

async function createConn(connectors, userId) {
  return connectors.create(userId, {
    kind: 'http', name: 'Boom', endpoint: 'https://boom.example.com/x', toolName: 'boom_tool', schemaSpec: { type: 'object' },
  });
}

test('mcp: initialize → notifications/initialized → tools/list (JSON + SSE, session header)', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_mcp', {
    kind: 'mcp', name: 'Mock MCP', endpoint: 'https://mcp.example.com/mcp', secret: 'mcp-secret',
  });
  recorded.length = 0;
  const discovery = await connectors.discover('user_mcp', c.id);
  assert.equal(discovery.protocol, 'mcp_streamable_http');
  assert.deepEqual(discovery.transports, { supported: ['streamable_http'], unsupported: ['stdio', 'sse_legacy', 'websocket'] });
  assert.equal(discovery.session, 'sess-123');
  assert.equal(discovery.tools[0].name, 'mock_echo');
  assert.equal(discovery.tools[0].inputSchema.properties.text.type, 'string');

  assert.equal(recorded.length, 3);
  const [initReq, notifReq, listReq] = recorded;
  assert.equal(initReq.url, 'https://mcp.example.com/mcp');
  assert.deepEqual(JSON.parse(initReq.body), {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'zeno-ai', version: '1.0.0' } },
  });
  assert.equal(notifReq.body, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(notifReq.headers['Mcp-Session-Id'], 'sess-123');
  assert.equal(listReq.headers['Mcp-Session-Id'], 'sess-123');
  assert.equal(listReq.headers['MCP-Protocol-Version'], '2025-06-18');
  assert.deepEqual(JSON.parse(listReq.body), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

  const row = repos.connectors.getConnector('user_mcp', c.id);
  assert.equal(row.status, 'connected');
  await connectors.remove('user_mcp', c.id);
});

test('mcp tools/call round trip with session header and text result', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_mcpcall', {
    kind: 'mcp', name: 'Mock MCP', endpoint: 'https://mcp.example.com/mcp', secret: 'mcp-secret',
  });
  const tool = (await connectors.catalog('user_mcpcall')).get('mcp_mock_mcp_mock_echo');
  assert.ok(tool);
  recorded.length = 0;
  const call = await tool.execute({ text: 'hi' }, { signal: AbortSignal.timeout(2000) });
  assert.equal(call.ok, true);
  assert.match(call.content, /mock says: {"text":"hi"}/);
  const callReq = recorded[recorded.length - 1];
  assert.deepEqual(JSON.parse(callReq.body), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mock_echo', arguments: { text: 'hi' } } });
  assert.equal(callReq.headers['Mcp-Session-Id'], 'sess-123');
  await connectors.remove('user_mcpcall', c.id);
});

test('mcp failure marks connector error status with detail', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_mcperr', {
    kind: 'mcp', name: 'Bad MCP', endpoint: 'https://mcpbad.example.com/mcp',
  });
  recorded.length = 0;
  await assert.rejects(connectors.discover('user_mcperr', c.id), /initialize failed/i);
  const row = repos.connectors.getConnector('user_mcperr', c.id);
  assert.equal(row.status, 'error');
  assert.match(row.statusDetail, /initialize/i);
  await connectors.remove('user_mcperr', c.id);
});

test('per-user catalog isolation: only own, only enabled', async () => {
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const a = await connectors.create('user_iso_a', {
    kind: 'http', name: 'A Tool', endpoint: 'https://a.example.com/x', toolName: 'a_tool', schemaSpec: { type: 'object' },
  });
  const b = await connectors.create('user_iso_b', {
    kind: 'http', name: 'B Tool', endpoint: 'https://b.example.com/x', toolName: 'b_tool', schemaSpec: { type: 'object' },
  });
  await connectors.setEnabled('user_iso_b', b.id, false);

  const catA = await connectors.catalog('user_iso_a');
  assert.ok(catA.has('a_tool'));
  assert.ok(!catA.has('b_tool'));
  const catB = await connectors.catalog('user_iso_b');
  assert.ok(!catB.has('b_tool'));
  assert.ok(!catB.has('a_tool'));
  assert.equal((await connectors.catalog('user_iso_c')).size, 0);

  await connectors.remove('user_iso_a', a.id);
  await connectors.remove('user_iso_b', b.id);
});

test('global registry untouched by connector catalogs', async () => {
  const { allToolDescriptors } = await import('../backend/tools/registry.js');
  const connectors = createConnectorService({ repos, audit: noopAudit, transport: mockTransport, validateEndpoint: allowAllEndpoint });
  const c = await connectors.create('user_registry', {
    kind: 'mcp', name: 'Never', endpoint: 'https://never.example.com/mcp',
  });
  await connectors.catalog('user_registry');
  assert.ok(allToolDescriptors().every((t) => !t.name.startsWith('mcp_') && !t.name.startsWith('connector_')));
  await connectors.remove('user_registry', c.id);
});
