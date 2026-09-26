
import { upstreamFromResponse } from '../core/errors.js';

function toOllamaMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? safeJson(tc.arguments) : tc.arguments || {},
          },
        })),
      };
    }
    const images = m.images?.length ? m.images.map((img) => img.base64) : undefined;
    return { role: m.role, content: m.content, ...(images ? { images } : {}) };
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

function base(base_url) {
  return base_url.replace(/\/+$/, '');
}

async function chatStream(ctx) {
  const { baseUrl, apiKey, headers, model, messages, tools, params, signal, onDelta, onToolCall, onUsage } = ctx;

  const body = {
    model,
    messages: toOllamaMessages(messages),
    stream: true,
    ...(tools?.length
      ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } })) }
      : {}),
    ...(params?.temperature !== undefined ? { options: { temperature: params.temperature, ...(params?.top_p !== undefined ? { top_p: params.top_p } : {}) } } : {}),
  };

  const response = await fetch(base(baseUrl) + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(headers || {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Ollama', response.status, text || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finishReason = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.error) throw upstreamFromResponse('Ollama', 500, ev.error);
        if (ev.message?.content) onDelta?.({ type: 'text', text: ev.message.content });
        if (ev.message?.thinking) onDelta?.({ type: 'reasoning', text: ev.message.thinking });
        if (ev.message?.tool_calls) {
          for (const tc of ev.message.tool_calls) {
            onToolCall?.({
              id: `call_${Math.random().toString(36).slice(2, 10)}`,
              name: tc.function?.name,
              arguments: tc.function?.arguments || {},
            });
          }
        }
        if (ev.prompt_eval_count || ev.eval_count) {
          usage = {
            promptTokens: ev.prompt_eval_count ?? null,
            completionTokens: ev.eval_count ?? null,
          };
        }
        if (ev.done) finishReason = ev.done_reason || 'stop';
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (usage) onUsage?.(usage);
  return { finishReason: finishReason || 'stop' };
}

async function listModels({ baseUrl, apiKey, headers, signal }) {
  const response = await fetch(base(baseUrl) + '/api/tags', {
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(headers || {}) },
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Ollama', response.status, text || response.statusText);
  }
  const data = await response.json();
  return (data?.models || [])
    .map((m) => ({ id: m.name, name: m.name, size: m.size }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function embed({ baseUrl, apiKey, headers, model, input, signal }) {
  const response = await fetch(base(baseUrl) + '/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(headers || {}) },
    body: JSON.stringify({ model, input }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw upstreamFromResponse('Ollama', response.status, text || response.statusText);
  }
  const data = await response.json();
  const list = data?.embeddings || [];
  return list;
}

export const ollamaAdapter = { name: 'ollama', chatStream, listModels, embed };
