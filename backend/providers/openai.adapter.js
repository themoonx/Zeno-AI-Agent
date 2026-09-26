








import { upstreamFromResponse } from '../core/errors.js';

function buildHeaders(apiKey, extraHeaders) {
  const h = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function messagesToOpenAI(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}) },
        })),
      };
    }
    
    if (m.images?.length && m.role === 'user') {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toolsToOpenAI(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } },
  }));
}

async function readSseLines(response, onLine, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line) onLine(line);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function chatStream(ctx) {
  const { baseUrl, apiKey, headers, model, messages, tools, params, signal, onDelta, onToolCall, onUsage } = ctx;

  const body = {
    model,
    messages: messagesToOpenAI(messages),
    stream: true,
    stream_options: { include_usage: true },
    ...(tools?.length ? { tools: toolsToOpenAI(tools), tool_choice: 'auto' } : {}),
    ...sanitizeParams(params),
  };

  const endpoint = joinUrl(baseUrl, '/chat/completions');
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(apiKey, headers),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw upstreamFromResponse(endpoint, 0, `Could not reach ${endpoint}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse(model, response.status, text || response.statusText);
  }

  
  const pendingTools = new Map();
  let finishReason = null;
  let usage = null;

  await readSseLines(
    response,
    (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? null,
          completionTokens: chunk.usage.completion_tokens ?? null,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.reasoning_content || delta.reasoning) {
        onDelta?.({ type: 'reasoning', text: delta.reasoning_content || delta.reasoning });
      }
      if (delta.content) onDelta?.({ type: 'text', text: delta.content });
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!pendingTools.has(idx)) pendingTools.set(idx, { id: tc.id || `call_${idx}`, name: '', arguments: '' });
          const acc = pendingTools.get(idx);
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    },
    signal
  );

  
  for (const [, acc] of pendingTools) {
    if (!acc.name) continue;
    let args = {};
    try {
      args = acc.arguments ? JSON.parse(acc.arguments) : {};
    } catch {
      args = { _raw: acc.arguments };
    }
    onToolCall?.({ id: acc.id, name: acc.name, arguments: args });
  }
  if (usage) onUsage?.(usage);
  return { finishReason: finishReason || (pendingTools.size ? 'tool_calls' : 'stop') };
}

function sanitizeParams(params = {}) {
  
  const allowed = ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty', 'seed', 'stop'];
  const out = {};
  for (const k of allowed) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') out[k] = params[k];
  }
  return out;
}

async function listModels({ baseUrl, apiKey, headers, signal }) {
  const endpoint = joinUrl(baseUrl, '/models');
  const response = await fetch(endpoint, { headers: buildHeaders(apiKey, headers), signal });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse(endpoint, response.status, text || response.statusText);
  }
  const data = await response.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list
    .map((m) => ({ id: m.id || m.name, name: m.name || m.id }))
    .filter((m) => !!m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function embed({ baseUrl, apiKey, headers, model, input, signal }) {
  const endpoint = joinUrl(baseUrl, '/embeddings');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(apiKey, headers),
    body: JSON.stringify({ model, input }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse(endpoint, response.status, text || response.statusText);
  }
  const data = await response.json();
  const list = data?.data || [];
  return list.map((d) => d.embedding);
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

export const openAiAdapter = { name: 'openai-compatible', chatStream, listModels, embed };
