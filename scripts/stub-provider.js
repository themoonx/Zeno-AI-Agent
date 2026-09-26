


import http from 'node:http';

const PORT = Number(process.env.STUB_PORT || 9101);

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'stub-chat-1' }, { id: 'stub-embed-1' }] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/embeddings') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const data = (Array.isArray(parsed.input) ? parsed.input : [parsed.input]).map((text, i) => ({
        object: 'embedding',
        index: i,
        embedding: embed(text),
      }));
      res.end(JSON.stringify({ object: 'list', data }));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const wantsTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
      const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user')?.content || '';
      
      
      
      
      const lastUserIdx = parsed.messages.map((m) => m.role).lastIndexOf('user');
      const hasToolResult = parsed.messages.slice(lastUserIdx + 1).some((m) => m.role === 'tool');
      const text = String(lastUser);

      if (wantsTools && /USE_FILE_TOOL/i.test(text) && !hasToolResult) {
        
        const m = text.match(/write\s+([\w.-]+\.txt)/i);
        const fileName = m ? m[1] : 'hello.txt';
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_stub_1', type: 'function', function: { name: 'file_write', arguments: '' } }] } }] });
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"' + fileName + '","content":"Written by the stub-driven agent at ' + new Date().toISOString() + '"}' } }] } }] });
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        sse(res, { choices: [], usage: { prompt_tokens: 21, completion_tokens: 13 } });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (wantsTools && /USE_TERMINAL/i.test(text) && !hasToolResult) {
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_stub_t', type: 'function', function: { name: 'terminal', arguments: '{"command":"node -e \\"console.log(6*7)\\""}' } }] } }] });
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (wantsTools && /USE_LOCAL_TOOL/i.test(text) && !hasToolResult) {
        
        const root = (process.env.ZENO_LOCAL_ROOTS || process.env.ZENO_LOCAL_ROOT_FALLBACK || '.').split(';')[0].replace(/\\+$/, '');
        const args = JSON.stringify({ path: root + '/daemon-e2e.txt', content: 'Written by Zeno through the local agent relay at ' + new Date().toISOString() });
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_stub_l', type: 'function', function: { name: 'local_write', arguments: '' } }] } }] });
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] });
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (wantsTools && /FAIL_THEN_SUCCEED/i.test(text) && !hasToolResult) {
        sse(res, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_stub_f', type: 'function', function: { name: 'no_such_tool', arguments: '{}' } }] } }] });
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      
      let reply;
      const isPlanner = /planner inside Zeno/i.test(String(parsed.messages.find((m) => m.role === 'system')?.content || ''));
      if (isPlanner && /Task:/i.test(text)) {
        
        reply = '{"steps":[{"title":"Do the thing","detail":"use a tool"},{"title":"Report"}]}';
      } else if (hasToolResult) {
        reply = 'Final answer: the tool ran and I confirmed it. Task complete.';
      } else if (/EXTRACT/i.test(String(parsed.messages.find((m) => m.role === 'system')?.content || ''))) {
        reply = '["Prefers concise answers","Ships on Fridays"]';
      } else {
        reply = 'Hello from the stub model. This is a streaming response.';
      }

      for (const word of reply.split(/(?<=\s)/)) {
        sse(res, { choices: [{ index: 0, delta: { content: word } }] });
      }
      sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      sse(res, { choices: [], usage: { prompt_tokens: 12, completion_tokens: reply.length } });
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});



function embed(text) {
  const vec = new Array(64).fill(0);
  const tokens = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    let hash = 0;
    for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
    vec[hash % 64] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

server.listen(PORT, () => console.log(`stub provider on :${PORT}`));
